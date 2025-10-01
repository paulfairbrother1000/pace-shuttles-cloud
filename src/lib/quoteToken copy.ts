// src/lib/quoteToken.ts
import crypto from "crypto";

// ---- Types ----
export type QuotePayloadV1 = {
  v: 1;
  routeId: string;
  journeyId: string;
  date: string;         // YYYY-MM-DD
  qty: number;

  // per-seat split in *cents* (already compounded such that
  // base + tax + fees (with fees on base+tax) == per-seat all-in)
  base_cents: number;
  tax_cents: number;
  fees_cents: number;

  // total for the whole party, in cents
  total_cents: number;

  currency: string;     // e.g. "GBP"
  iat: number;          // issued at (seconds)
  exp: number;          // expiry (seconds)
};

type VerifyResult =
  | { ok: true; payload: QuotePayloadV1 }
  | { ok: false; error: string };

// ---- Helpers (base64url) ----
function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJson(obj: any): string {
  return b64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

function b64urlToBuf(b64u: string): Buffer {
  // add padding back
  const pad = 4 - (b64u.length % 4 || 4);
  const base64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(base64, "base64");
}

function hmac256(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

// ---- Public API ----

/**
 * Sign a quote payload (HS256 JWT).
 * Provide the same secret that /api/checkout will verify with.
 */
export async function signQuote(
  payload: QuotePayloadV1,
  opts?: { secret?: string }
): Promise<string> {
  const secret = opts?.secret ?? process.env.QUOTE_SIGNING_SECRET ?? "";
  if (!secret) throw new Error("QUOTE_SIGNING_SECRET missing to sign token");

  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = b64urlJson(header);
  const encPayload = b64urlJson(payload);
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = hmac256(secret, signingInput);
  const encSig = b64url(sig);
  return `${signingInput}.${encSig}`;
}

/**
 * Verify a token. Checks signature and exp>=now.
 * Returns { ok:false, error } on any issue, never throws.
 */
export async function verifyQuote(
  token: string,
  opts?: { secret?: string }
): Promise<VerifyResult> {
  try {
    if (typeof token !== "string" || token.trim().length < 20) {
      return { ok: false, error: "token_missing_or_too_short" };
    }

    const secret = opts?.secret ?? process.env.QUOTE_SIGNING_SECRET ?? "";
    if (!secret) return { ok: false, error: "secret_missing" };

    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, error: "jwt_malformed" };

    const [encHeader, encPayload, encSig] = parts;
    const signingInput = `${encHeader}.${encPayload}`;
    const expected = hmac256(secret, signingInput);
    const got = b64urlToBuf(encSig);

    // timing-safe compare
    if (
      expected.length !== got.length ||
      !crypto.timingSafeEqual(expected, got)
    ) {
      return { ok: false, error: "bad_signature" };
    }

    // decode payload
    const payloadJson = b64urlToBuf(encPayload).toString("utf8");
    const payload = JSON.parse(payloadJson) as QuotePayloadV1;

    // basic shape check
    if (!payload?.v || payload.v !== 1) {
      return { ok: false, error: "unsupported_version" };
    }
    if (!payload.routeId || !payload.date || !payload.qty) {
      return { ok: false, error: "payload_missing_required_fields" };
    }

    // exp / iat
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) {
      return { ok: false, error: "expired" };
    }
    if (typeof payload.iat !== "number" || payload.iat > now + 60) {
      // allow small clock skew forward
      return { ok: false, error: "iat_in_future" };
    }

    return { ok: true, payload };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || "verify_exception") };
  }
}

/** Convert the payload back to per-seat all-in (units). */
export function perSeatAllInFromPayload(p: QuotePayloadV1): number {
  if (!p || typeof p.total_cents !== "number" || typeof p.qty !== "number" || p.qty <= 0) return 0;
  return p.total_cents / p.qty / 100;
}
