// src/app/api/quote/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ========= local token types & signer (HS256 JWT) ========= */
export type QuotePayloadV1 = {
  v: 1;
  routeId: string;
  journeyId: string;
  date: string;         // YYYY-MM-DD
  qty: number;
  base_cents: number;
  tax_cents: number;
  fees_cents: number;
  total_cents: number;
  currency: string;     // e.g. "GBP"
  iat: number;          // issued at (seconds)
  exp: number;          // expiry (seconds)
};

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlJson(obj: any): string { return b64url(Buffer.from(JSON.stringify(obj), "utf8")); }
function hmac256(secret: string, data: string): Buffer { return crypto.createHmac("sha256", secret).update(data).digest(); }
async function signQuoteLocal(payload: QuotePayloadV1, secret: string): Promise<string> {
  if (!secret) throw new Error("QUOTE_SIGNING_SECRET missing to sign token");
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = b64url(hmac256(secret, signingInput));
  return `${signingInput}.${sig}`;
}

/* ========= env / supabase ========= */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // server-only
const QUOTE_SECRET = process.env.QUOTE_SIGNING_SECRET || "";

// Always use the service role in this server-only route.
function sbAdmin() {
  if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");
  if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set on the server");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/* ========= helpers ========= */
const r2 = (n: number) => Math.round(n * 100) / 100;

function asFraction(x: unknown): number {
  let n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1) n = n / 100;  // supports “5” meaning 5%
  if (n > 1) n = 1;
  return n;
}

/** Base seat price in **POUNDS** (not minor units) */
function baseSeatPrice(minvalueRaw: number, minseatsRaw: number) {
  const ms = Math.max(1, Number(minseatsRaw));
  const mv = Math.max(0, Number(minvalueRaw)); // stored as pounds in DB (e.g., 400 = £400)
  return Math.ceil(mv / ms);                   // pounds per seat, whole-£ rounded up
}

function splitAllInPounds(basePounds: number, taxRate: number, feesRate: number) {
  const base_cents = Math.round(basePounds * 100);
  const tax_cents = Math.round(base_cents * taxRate);
  const base_plus_tax = base_cents + tax_cents;
  const fees_cents = Math.round(base_plus_tax * feesRate);
  const unit_cents = Math.ceil((base_plus_tax + fees_cents) / 100) * 100; // round to whole £
  return { base_cents, tax_cents, fees_cents, unit_cents };
}

/** common diag-friendly response */
function ok(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function fail(step: string, error: any, diag: boolean, whoami?: any) {
  const msg = typeof error?.message === "string" ? error.message : String(error);
  if (diag) return ok({ error_code: "internal_error", step, details: msg, _diag: { whoami } }, 200);
  return ok({ error_code: "internal_error" }, 500);
}

/* ========= data access ========= */

async function ensureJourneyId(routeId: string, dateISO: string, diag = false) {
  const db = sbAdmin();
  try {
    const { data, error } = await db.rpc("ps_ensure_journey", { p_route_id: routeId, p_day: dateISO });
    if (error) throw error;
    if (data) return String(data);
  } catch (e) {
    if (diag) console.warn("[quote] ps_ensure_journey RPC failed:", e);
  }
  try {
    const { data, error } = await db
      .from("journeys")
      .select("id")
      .eq("route_id", routeId)
      .gte("departure_ts", `${dateISO}T00:00:00.000Z`)
      .lt("departure_ts", `${dateISO}T23:59:59.999Z`)
      .limit(1);
    if (error) throw error;
    return data?.[0]?.id ?? null;
  } catch (e) {
    if (diag) console.warn("[quote] ensureJourneyId fallback failed:", e);
    throw e;
  }
}

async function getJourneyMeta(journeyId: string) {
  const db = sbAdmin();
  const { data, error } = await db
    .from("journeys")
    .select("id, route_id, departure_ts, locked_at, lock_mode")
    .eq("id", journeyId)
    .maybeSingle();
  if (error) throw error;
  const dep = data?.departure_ts ? new Date(data.departure_ts) : null;
  const hoursOut = dep ? Math.max(0, (dep.getTime() - Date.now()) / 36e5) : null;
  return {
    route_id: data?.route_id as string | null,
    departure_ts: dep,
    hoursOut,
    locked_at: data?.locked_at ?? null,
    lock_mode: (data?.lock_mode as string | null) ?? "preview",
  };
}

async function getSoldSeats(journeyId: string) {
  const db = sbAdmin();
  const { data, error } = await db
    .from("bookings")
    .select("vehicle_id,seats,status")
    .eq("journey_id", journeyId);
  if (error) throw error;

  let total = 0;
  const byVeh: Record<string, number> = {};
  for (const b of data || []) {
    const status = String(b.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "canceled") continue;
    const n = Math.max(0, Number(b.seats ?? 0));
    total += n;
    const vid = (b as any).vehicle_id ?? "__unassigned__";
    byVeh[vid] = (byVeh[vid] ?? 0) + n;
  }
  return { byVehicle: byVeh, totalSold: total };
}

async function loadAssignedVehiclesFlexible(routeId: string) {
  const db = sbAdmin();

  const { data: assigns, error: aErr } = await db
    .from("route_vehicle_assignments")
    .select("vehicle_id, preferred, is_active")
    .eq("route_id", routeId)
    .eq("is_active", true);
  if (aErr) throw new Error(`route_vehicle_assignments: ${aErr.message}`);

  const active = (assigns || []);
  if (!active.length) return { items: [] as any[], source: "none" };

  const vehicleIds = [...new Set(active.map((r: any) => r.vehicle_id).filter(Boolean))];

  let items: any[] = [];
  let source = "vehicles";

  if (vehicleIds.length) {
    const { data: v1, error: v1Err } = await db
      .from("vehicles")
      .select("id, name, operator_id, minseats, maxseats, minvalue, maxseatdiscount, active")
      .in("id", vehicleIds);

    if (!v1Err && (v1?.length || 0) > 0) {
      items = active
        .map((a) => {
          const v = v1!.find((vv) => vv.id === a.vehicle_id);
          return v
            ? {
                id: v.id,
                name: v.name,
                operator_id: v.operator_id ?? null,
                minseats: Number(v.minseats ?? 0),
                maxseats: Number(v.maxseats ?? 0),
                minvalue: Number(v.minvalue ?? 0),
                maxseatdiscount: v.maxseatdiscount != null ? Number(v.maxseatdiscount) : null,
                preferred_route: Boolean(a.preferred),
                active: Boolean((v as any).active ?? true),
              }
            : null;
        })
        .filter(Boolean) as any[];
    } else {
      source = "transport_types";
      const { data: v2, error: v2Err } = await db
        .from("transport_types")
        .select("id, name, operator_id, minseats, maxseats, minvalue, maxseatdiscount")
        .in("id", vehicleIds);
      if (v2Err) throw new Error(`transport_types: ${v2Err.message}`);

      items = active
        .map((a) => {
          const v = v2!.find((vv) => vv.id === a.vehicle_id);
          return v
            ? {
                id: v.id,
                name: v.name,
                operator_id: v.operator_id ?? null,
                minseats: Number(v.minseats ?? 0),
                maxseats: Number(v.maxseats ?? 0),
                minvalue: Number(v.minvalue ?? 0),
                maxseatdiscount: v.maxseatdiscount != null ? Number(v.maxseatdiscount) : null,
                preferred_route: Boolean(a.preferred),
                active: true,
              }
            : null;
        })
        .filter(Boolean) as any[];
    }
  }

  // Optional operator decorations (best-effort)
  try {
    const opIds = [...new Set(items.map((x) => x.operator_id).filter(Boolean))];
    if (opIds.length) {
      const { data: opRows } = await db.from("operators").select("id,name,csat");
      const m: Record<string, { name: string | null; csat: number }> = {};
      for (const o of opRows || []) m[o.id] = { name: o.name ?? null, csat: Number(o.csat ?? 0) };
      items = items.map((v) => ({
        ...v,
        operator_name: v.operator_id ? m[v.operator_id]?.name ?? null : null,
        operator_csat: v.operator_id ? m[v.operator_id]?.csat ?? 0 : 0,
      }));
    } else {
      items = items.map((v) => ({ ...v, operator_name: null, operator_csat: 0 }));
    }
  } catch {
    items = items.map((v) => ({ ...v, operator_name: null, operator_csat: 0 }));
  }

  // Only keep active craft with meaningful pricing inputs
  items = items.filter(v => v.active !== false && (v.minvalue ?? 0) > 0 && (v.minseats ?? 0) > 0);

  return { items, source };
}

/** Sort: cheapest base → higher CSAT (if different operator) → preferred → name/id. */
function decorateAndSort(vehicles: Array<{
  id: string; name: string; operator_id: string | null; minseats: number; maxseats: number;
  minvalue: number; maxseatdiscount: number | null; preferred_route: boolean; operator_name?: string | null; operator_csat?: number;
}>) {
  return [...vehicles]
    .map((v) => ({ ...v, base_price: baseSeatPrice(v.minvalue, v.minseats), operator_csat: v.operator_csat ?? 0 }))
    .sort((a, b) => {
      if (a.base_price !== b.base_price) return a.base_price - b.base_price;
      if ((a.operator_id ?? "") !== (b.operator_id ?? "")) return (b.operator_csat ?? 0) - (a.operator_csat ?? 0);
      if (a.preferred_route !== b.preferred_route) return a.preferred_route ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "") || a.id.localeCompare(b.id);
    });
}

/** For each vehicle: { open, discountActive } baseline on cumulative mins. */
function computeOpenInfo(list: ReturnType<typeof decorateAndSort>, totalSold: number) {
  const cumMin: number[] = [];
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    s += Math.max(0, list[i].minseats);
    cumMin.push(s);
  }
  const res: Record<string, { open: boolean; discountActive: boolean }> = {};
  for (let i = 0; i < list.length; i++) {
    const open = i === 0 ? true : totalSold >= cumMin[i - 1];
    const discountActive = totalSold >= (i + 1 < cumMin.length ? cumMin[i] : Infinity);
    res[list[i].id] = { open, discountActive };
  }
  return res;
}

/* ========= core handler ========= */
async function handleQuote(req: NextRequest) {
  const method = req.method.toUpperCase();
  const isGet = method === "GET";
  const isPost = method === "POST";
  if (!isGet && !isPost) return ok({ error_code: "method_not_allowed" }, 405);

  const params = isGet ? new URL(req.url).searchParams : null;
  const body = isPost ? await req.json().catch(() => ({})) : {};

  const routeId =
    (params?.get("routeId") ||
      params?.get("route_id") ||
      (body as any).routeId ||
      (body as any).route_id ||
      "") + "";
  const dateISO = ((params?.get("date") || (body as any).date || "") as string).slice(0, 10);
  const qty = Math.max(1, Number(params?.get("qty") ?? (body as any).qty ?? 1));
  const vehiclePin = params?.get("vehicle_id") || (body as any).vehicle_id || null;

  const diag =
    (params?.get("diag") || (body as any).diag) === "1" ||
    (params?.get("diag") === "true");

  if (!routeId || !dateISO || !Number.isFinite(qty)) {
    return ok({ error_code: "bad_request", details: "Missing or invalid routeId/date/qty" }, 400);
  }
  if (!QUOTE_SECRET) return fail("env:QUOTE_SIGNING_SECRET", new Error("missing secret"), diag);

  /* ========= WHOAMI: put into the response when diag=1 ========= */
  let whoami: any = null;
  if (diag) {
    try {
      const db = sbAdmin();
      const { data } = await db.rpc("http_role_whoami");
      whoami = data ?? null;
    } catch (e) {
      whoami = { error: String((e as any)?.message || e) };
    }
  }

  try {
    /* 1) journey */
    let journeyId: string | null = null;
    try {
      journeyId = await ensureJourneyId(routeId, dateISO, diag);
    } catch (e) {
      return fail("ensureJourneyId", e, diag, whoami);
    }
    if (!journeyId) return ok({ availability: "no_journey", error_code: "no_journey", _diag: diag ? { whoami } : undefined });

    // Journey meta for time-based rules (T-72 discount / T-24 readiness)
    const jmeta = await getJourneyMeta(journeyId);
    const hoursOut = jmeta.hoursOut ?? null;

    /* 2) vehicles */
    let vRes: { items: any[]; source: string };
    try {
      vRes = await loadAssignedVehiclesFlexible(routeId);
    } catch (e) {
      return fail("loadAssignedVehiclesFlexible", e, diag, whoami);
    }
    if (!vRes.items.length) {
      return ok(
        diag
          ? { availability: "no_vehicles", error_code: "no_vehicles", source: vRes.source, note: "no active assignments or craft missing", _diag: { whoami } }
          : { availability: "no_vehicles", error_code: "no_vehicles" }
      );
    }
    let vehicles = decorateAndSort(vRes.items);

    if (vehiclePin) {
      const v = vehicles.find(x => x.id === vehiclePin);
      vehicles = v ? [v] : [];
      if (!vehicles.length) {
        return ok({ availability: "no_vehicles", error_code: "vehicle_not_assigned_or_inactive", _diag: diag ? { whoami } : undefined });
      }
    }

    /* 3) availability counts */
    let byVehicle: Record<string, number>, totalSold: number;
    try {
      const seatInfo = await getSoldSeats(journeyId);
      byVehicle = seatInfo.byVehicle;
      totalSold = seatInfo.totalSold;
    } catch (e) {
      return fail("getSoldSeats", e, diag, whoami);
    }
    const openInfoBase = computeOpenInfo(vehicles as any, totalSold);

    const totalMax = vehicles.reduce((s, v) => s + Math.max(0, v.maxseats), 0);
    const remainingOverall = totalMax - totalSold;
    if (remainingOverall <= 0) return ok({ availability: "sold_out", _diag: diag ? { whoami } : undefined });

    /* 4) tax/fees (country-aware first, then global fallback) */
    const db = sbAdmin();

    // Route -> country
    let routeCountryId: string | null = null;
    try {
      const { data: rRow, error: rErr } = await db
        .from("routes")
        .select("country_id")
        .eq("id", routeId)
        .maybeSingle();
      if (rErr) throw rErr;
      routeCountryId = (rRow?.country_id as string) ?? null;
    } catch {
      routeCountryId = null;
    }

    let taxRate = 0, feesRate = 0;
    try {
      if (routeCountryId) {
        const { data, error } = await db
          .from("tax_fees")
          .select("tax,fees")
          .eq("country_id", routeCountryId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          taxRate = asFraction(data.tax ?? 0);
          feesRate = asFraction(data.fees ?? 0);
        }
      }
      // Fallback: most recent global (if any)
      if (taxRate === 0 && feesRate === 0) {
        const { data, error } = await db
          .from("tax_fees")
          .select("tax,fees")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          taxRate = asFraction(data.tax ?? 0);
          feesRate = asFraction(data.fees ?? 0);
        }
      }
    } catch (e) {
      if (diag) console.warn("[quote] tax_fees read failed:", e);
      taxRate = taxRate || 0;
      feesRate = feesRate || 0;
    }

    /* 5) choose candidate craft (apply baseline open + T-72 discount rule) */
    type Candidate = { v: typeof vehicles[number]; price_unit: number; remaining: number; discountActive: boolean };
    const candidates: Candidate[] = [];

    for (const v of vehicles) {
      const open = openInfoBase[v.id]?.open ?? false;
      if (!open) continue;

      const soldOnThis = byVehicle[v.id] ?? 0;
      const remaining = Math.max(0, Number(v.maxseats) - soldOnThis);
      if (remaining <= 0) continue;

      const baseNoDisc = (v as any).base_price as number;

      // Baseline discount trigger (fill-next-boat model)
      const baselineDiscount = openInfoBase[v.id]?.discountActive ?? false;

      // T-72 rule: if <=72h and vehicle has NOT met min seats (or is at min-1), discount active
      const timeDiscount =
        (hoursOut !== null && hoursOut <= 72) &&
        (soldOnThis < v.minseats || soldOnThis === v.minseats - 1);

      const discountActive = baselineDiscount || timeDiscount;
      const disc = asFraction(v.maxseatdiscount ?? 0);
      const effectiveBase = discountActive ? Math.ceil(baseNoDisc * (1 - disc)) : baseNoDisc;

      const { unit_cents } = splitAllInPounds(effectiveBase, taxRate, feesRate);

      candidates.push({ v: v as any, price_unit: unit_cents, remaining, discountActive });
    }

    if (!candidates.length) {
      return ok({ availability: "sold_out", _diag: diag ? { whoami } : undefined });
    }

    candidates.sort((a, b) => {
      if (a.price_unit !== b.price_unit) return a.price_unit - b.price_unit;
      const ia = vehicles.findIndex((x) => x.id === a.v.id);
      const ib = vehicles.findIndex((x) => x.id === b.v.id);
      return ia - ib;
    });

    const chosen = candidates[0];
    if (qty > chosen.remaining) {
      return ok({
        availability: "insufficient_capacity_for_party",
        message: `Only ${chosen.remaining} seats available at this price.`,
        max_qty_at_price: chosen.remaining,
        currency: "GBP",
        vehicle_id: chosen.v.id,
        vehicle_name: chosen.v.name,
        _diag: diag ? { whoami, hoursOut } : undefined,
      });
    }

    /* 6) per-seat split + token */
    const baseNoDisc = (chosen.v as any).base_price as number;
    const disc = asFraction(chosen.v.maxseatdiscount ?? 0);
    const base = chosen.discountActive ? Math.ceil(baseNoDisc * (1 - disc)) : baseNoDisc;

    const { base_cents, tax_cents, fees_cents, unit_cents } = splitAllInPounds(base, taxRate, feesRate);
    const now = Math.floor(Date.now() / 1000);

    const payload: QuotePayloadV1 = {
      v: 1,
      routeId,
      journeyId,
      date: dateISO,
      qty,
      base_cents,
      tax_cents,
      fees_cents,
      total_cents: unit_cents * qty,
      currency: "GBP",
      iat: now,
      exp: now + 15 * 60,
    };

    let token: string;
    try {
      token = await signQuoteLocal(payload, QUOTE_SECRET);
    } catch (e) {
      return fail("signQuoteLocal", e, diag, whoami);
    }

    const resp: any = {
      availability: "available",
      qty,
      unit_cents,
      base_cents,
      tax_cents,
      fees_cents,
      total_cents: payload.total_cents,
      currency: payload.currency,
      token,
      vehicle_id: chosen.v.id,
      vehicle_name: chosen.v.name,
      operator_name: (chosen.v as any).operator_name ?? null,
      remaining_on_vehicle: chosen.remaining,
      max_qty_at_price: chosen.remaining,
      open_discount_active: chosen.discountActive,
    };
    if (diag) resp._diag = { whoami, source: vRes.source, totalSold, byVehicle, taxRate, feesRate, hoursOut, lock_mode: jmeta.lock_mode };

    return ok(resp);
  } catch (e) {
    return fail("top-level", e, diag, undefined);
  }
}

export async function GET(req: NextRequest)  { return handleQuote(req); }
export async function POST(req: NextRequest) { return handleQuote(req); }

export {};
