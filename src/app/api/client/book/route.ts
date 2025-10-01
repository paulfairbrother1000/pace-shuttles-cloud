// src/app/api/checkout/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { verifyQuote, perSeatAllInFromPayload } from "@/lib/quoteToken";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const QUOTE_SECRET = process.env.QUOTE_SIGNING_SECRET!;

// ---------- helpers ----------
const r2 = (n: number) => Math.round(n * 100) / 100;
function asFraction(x: unknown): number {
  let n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1) n /= 100;
  if (n > 1) n = 1;
  return n;
}
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// ---------- route ----------
export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return NextResponse.json({ ok: false, error: "Supabase env not configured" }, { status: 500 });
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
    }
    if (!QUOTE_SECRET) {
      return NextResponse.json({ ok: false, error: "QUOTE_SIGNING_SECRET not set" }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    // From /book/pay
    let qid: string | null = body.qid ?? body.quote_intent_id ?? null;
    let routeId: string | null = body.routeId ?? body.route_id ?? null;
    let dateISO: string | null = body.date ?? null;
    let qty: number = Math.max(1, Number(body.qty ?? body.seats ?? 0));
    let token: string | null = body.token ?? body.quoteToken ?? null;
    let allInUnits: number | null = Number(body.allInC ?? body.perSeatAllIn);
    const currency: string = (body.ccy || "GBP").toUpperCase();

    // Hydrate from quote_intents if we have qid but are missing fields
    if (qid && (!token || !Number.isFinite(allInUnits) || !routeId || !dateISO || !qty)) {
      const { data: qi } = await sbAdmin()
        .from("quote_intents")
        .select("route_id,date_iso,seats,per_seat_all_in,quote_token")
        .eq("id", qid)
        .maybeSingle();
      if (qi) {
        if (!routeId) routeId = qi.route_id ?? routeId;
        if (!dateISO) dateISO = qi.date_iso ?? dateISO;
        if (!qty || qty < 1) qty = Math.max(1, Number(qi.seats ?? 1));
        if (!Number.isFinite(allInUnits)) allInUnits = Number(qi.per_seat_all_in);
        if (!token) token = qi.quote_token ?? token;
      }
    }

    // Validate basics
    if (!routeId || !dateISO || !qty || qty < 1 || !token) {
      return NextResponse.json({ ok: false, error: "Invalid request: route/date/qty/token required" }, { status: 400 });
    }

    // Verify JWT token and sanity-check against posted params
    const v = await verifyQuote(token, { secret: QUOTE_SECRET });
    if (!v.ok) {
      console.error("[/api/checkout] verifyQuote failed:", v.error);
      return NextResponse.json({ ok: false, error: "Quote token invalid/expired" }, { status: 400 });
    }
    const pay = v.payload;

    if (pay.routeId !== routeId || pay.date !== dateISO || pay.qty !== qty) {
      return NextResponse.json({ ok: false, error: "Quote does not match request" }, { status: 400 });
    }

    // Use amounts from the token, not the client body
    const perSeatAllIn = perSeatAllInFromPayload(pay); // units
    const total_cents = pay.total_cents;
    const unit_price_cents = Math.round(perSeatAllIn * 100);
    // (unit * qty) should equal total_cents; tolerate tiny rounding drift
    const expectedTotal = unit_price_cents * qty;
    if (Math.abs(expectedTotal - total_cents) > 1) {
      return NextResponse.json({ ok: false, error: "Price mismatch" }, { status: 400 });
    }

    // Auth
    const jar = await cookies();
    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => jar.set(name, value, options),
        remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
      },
    });
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Auth required" }, { status: 401 });
    const userId = auth.user.id;

    // Snapshot tax/fees (optional)
    const { data: tf } = await sb
      .from("tax_fees")
      .select("tax,fees")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const taxRate = asFraction(tf?.tax ?? 0);
    const feesRate = asFraction(tf?.fees ?? 0);

    // Re-split per-seat all-in into base/tax/fees (for order rows), in units
    const denom = 1 + taxRate + feesRate + taxRate * feesRate;
    const basePerSeat = denom ? r2(perSeatAllIn / denom) : 0;
    const taxPerSeat = r2(basePerSeat * taxRate);
    const feesPerSeat = r2((basePerSeat + taxPerSeat) * feesRate);

    const base_cents_total = Math.round(basePerSeat * 100) * qty;
    const tax_cents_total = Math.round(taxPerSeat * 100) * qty;
    const fees_cents_total = Math.round(feesPerSeat * 100) * qty;

    // Insert order
    const admin = sbAdmin();
    const { data: inserted, error: insErr } = await admin
      .from("orders")
      .insert({
        user_id: userId,
        status: "requires_payment",
        currency,

        route_id: routeId,
        journey_date: dateISO,
        qty,

        unit_price_cents,
        base_cents: base_cents_total,
        tax_cents: tax_cents_total,
        fees_cents: fees_cents_total,
        total_cents,

        // contact mirrors
        lead_first_name: body.lead_first_name ?? null,
        lead_last_name: body.lead_last_name ?? null,
        lead_email: body.lead_email ?? null,
        lead_phone: body.lead_phone ?? null,
      })
      .select("id, success_token")
      .maybeSingle();

    if (insErr || !inserted) {
      return NextResponse.json({ ok: false, error: insErr?.message || "Order insert failed" }, { status: 500 });
    }

    // Passengers
    type InboundPassenger = { first_name?: string; last_name?: string; is_lead?: boolean };
    const pax: InboundPassenger[] = Array.isArray(body.passengers) ? body.passengers : [];
    const paxRows = (pax.length ? pax : Array.from({ length: qty }, (_, i) => ({
      first_name: i === 0 ? "Guest" : "Guest",
      last_name: null,
      is_lead: i === 0,
    }))).slice(0, qty).map((p: any, i: number) => ({
      order_id: inserted.id,
      first_name: (p.first_name ?? "").toString() || (i === 0 ? "Guest" : "Guest"),
      last_name: (p.last_name ?? null) as string | null,
      is_lead: Boolean(p.is_lead) && i < qty,
    }));

    if (paxRows.length) {
      const { error: paxErr } = await admin.from("order_passengers").insert(paxRows);
      if (paxErr) console.warn("[/api/checkout] order_passengers warning:", paxErr.message);
    }

    // Success URL
    const url = `/orders/success2?orderId=${encodeURIComponent(inserted.id)}&s=${encodeURIComponent(
      inserted.success_token
    )}`;

    return NextResponse.json({ ok: true, order_id: inserted.id, url });
  } catch (e: any) {
    console.error("[/api/checkout] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal Server Error" }, { status: 500 });
  }
}
