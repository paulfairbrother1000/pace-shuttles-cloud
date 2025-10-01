// src/lib/quoteToken.ts
import crypto from "crypto";

// ---- Types ----
export type QuotePayloadV1 = {
  v: 1;
  routeId: string;
  journeyId: string;
  date: string;         // YYYY-MM-DD
  qty: number;

  // per-seat split in *cents* (already compounded)
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

// ---- base64url helpers ----
const b64url = {
  enc(input: Buffer | string): string {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
    return buf
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  },
  encJson(obj: any): string {
    return b64url.enc(Buffer.from(JSON.stringify(obj), "utf8"));
  },
  decToBuf(b64u: string): Buffer {
    const padLen = 4 - (b64u.length % 4 || 4);
    const base64 = b64u.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen === 4 ? 0 : padLen);
    return Buffer.from(base64, "base64");
  },
};

function hmac256(secret: string, data: string): Buffer {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

function coerceNumbers(p: any): QuotePayloadV1 {
  // Convert any string numerics to numbers to avoid arithmetic surprises
  return {
    ...p,
    qty: Number(p.qty),
    base_cents: Number(p.base_cents),
    tax_cents: Number(p.tax_cents),
    fees_cents: Number(p.fees_cents),
    total_cents: Number(p.total_cents),
    iat: Number(p.iat),
    exp: Number(p.exp),
  } as QuotePayloadV1;
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
  const encHeader = b64url.encJson(header);
  const encPayload = b64url.encJson(payload);
  const signingInput = `${encHeader}.${encPayload}`;
  const sig = hmac256(secret, signingInput);
  const encSig = b64url.enc(sig);
  return `${signingInput}.${encSig}`;
}

/**
 * Verify a token. Checks signature and exp/iat sanity.
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
    const got = b64url.decToBuf(encSig);

    // timing-safe compare
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      return { ok: false, error: "bad_signature" };
    }

    // decode payload
    const payloadJson = b64url.decToBuf(encPayload).toString("utf8");
    const raw = JSON.parse(payloadJson);
    const payload = coerceNumbers(raw);

    // basic shape check
    if (!payload?.v || payload.v !== 1) return { ok: false, error: "unsupported_version" };
    if (!payload.routeId || !payload.date || !payload.qty) {
      return { ok: false, error: "payload_missing_required_fields" };
    }

    // iat / exp (allow small clock skew)
    const now = Math.floor(Date.now() / 1000);
    const skew = 120; // 2 minutes
    if (typeof payload.exp !== "number" || payload.exp < now - skew) {
      return { ok: false, error: "expired" };
    }
    if (typeof payload.iat !== "number" || payload.iat > now + skew) {
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
