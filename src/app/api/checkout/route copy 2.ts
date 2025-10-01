export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { verifyQuote, type QuotePayloadV1 } from "@/lib/quoteToken";

/* ---------- Env ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const QUOTE_SECRET = process.env.QUOTE_SIGNING_SECRET!;
const CREATE_BOOKING_IMMEDIATELY = process.env.CREATE_BOOKING_IMMEDIATELY === "true";

/* ---------- Helpers ---------- */
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const r2 = (n: number) => Math.round(n * 100) / 100;
function asFraction(x: unknown): number {
  let n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1) n = n / 100;
  if (n > 1) n = 1;
  return n;
}
async function ensureJourneyId(routeId: string, dateISO: string): Promise<string | null> {
  try {
    const { data, error } = await sbAdmin().rpc("ps_ensure_journey", { p_route_id: routeId, p_day: dateISO });
    if (!error && data) return String(data);
  } catch {}
  const { data } = await sbAdmin()
    .from("journeys")
    .select("id")
    .eq("route_id", routeId)
    .gte("departure_ts", `${dateISO}T00:00:00.000Z`)
    .lt("departure_ts", `${dateISO}T23:59:59.999Z`)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/* ---------- Route ---------- */
export async function POST(req: NextRequest) {
  try {
    // sanity env checks
    if (!SUPABASE_URL || !SUPABASE_ANON) return NextResponse.json({ ok: false, error: "Supabase env not configured" }, { status: 500 });
    if (!SUPABASE_SERVICE_ROLE_KEY)       return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY not set" }, { status: 500 });
    if (!QUOTE_SECRET)                    return NextResponse.json({ ok: false, error: "QUOTE_SIGNING_SECRET not set" }, { status: 500 });

    const body = await req.json().catch(() => ({} as any));

    // incoming (camel OR snake accepted)
    let qid: string | null = body.qid || body.quote_intent_id || null;
    let routeId: string | null = body.routeId || body.route_id || null;
    let dateISO: string | null = body.date || body.date_iso || null;
    let qty: number = Math.max(1, Number(body.qty ?? body.seats ?? 0));
    let token: string | null = body.token || body.quoteToken || null;
    let allInUnits: number | null = Number(body.allInC ?? body.perSeatAllIn); // per-seat all-in, as shown to user (may be rounded/ceil)
    const currency: string = (body.ccy || "GBP").toUpperCase();

    // hydrate from quote_intents if provided
    if (qid && (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInUnits))) {
      const { data: qi } = await sbAdmin()
        .from("quote_intents")
        .select("route_id,date_iso,seats,per_seat_all_in,quote_token")
        .eq("id", qid)
        .maybeSingle();
      if (qi) {
        routeId      = routeId      || qi.route_id || null;
        dateISO      = dateISO      || qi.date_iso || null;
        qty          = qty > 0 ? qty : Math.max(1, Number(qi.seats ?? 1));
        allInUnits   = Number.isFinite(allInUnits) ? allInUnits : (qi.per_seat_all_in != null ? Number(qi.per_seat_all_in) : null);
        token        = token || qi.quote_token || null;
      }
    }

    // final required fields
    if (!routeId || !dateISO || !qty || qty < 1 || !token) {
      return NextResponse.json({ ok: false, error: "Invalid request: route/date/qty/token required" }, { status: 400 });
    }

    // verify JWT with same secret as /api/quote
    const v = await verifyQuote(token, { secret: QUOTE_SECRET });
    if (!v.ok) {
      const reason = v.error || "invalid";
      if (process.env.NODE_ENV !== "production") console.error("[/api/checkout] verifyQuote failed:", reason);
      return NextResponse.json(
        { ok: false, error: "Quote token invalid/expired", ...(process.env.NODE_ENV !== "production" ? { reason } : {}) },
        { status: 400 }
      );
    }
    const pay = v.payload as QuotePayloadV1;

    // basic payload checks (exact match)
    if (pay.routeId !== routeId || pay.date !== dateISO || pay.qty !== qty) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[/api/checkout] token context mismatch", { token: { routeId: pay.routeId, date: pay.date, qty: pay.qty }, body: { routeId, dateISO, qty } });
      }
      return NextResponse.json({ ok: false, error: "Quote token invalid/expired" }, { status: 400 });
    }

    // derive per-seat all-in from token (authoritative)
    const perSeatFromToken = pay.qty > 0 ? pay.total_cents / pay.qty / 100 : 0;

    // allow the UI's rounded/ceiling display (<= £1 tolerance to absorb ceil/round and tax recompute)
    if (Number.isFinite(allInUnits) && Math.abs(Number(allInUnits) - perSeatFromToken) > 1.01) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[/api/checkout] price mismatch", { ui: allInUnits, tokenPerSeat: perSeatFromToken });
      }
      return NextResponse.json({ ok: false, error: "Quote token invalid/expired" }, { status: 400 });
    }

    // require authenticated user
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

    // snapshot tax/fees (still useful to store, but order math will use token cents)
    const { data: tf } = await sb
      .from("tax_fees")
      .select("tax,fees")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const taxRate  = asFraction(tf?.tax ?? 0);
    const feesRate = asFraction(tf?.fees ?? 0);

    // cents from token (authoritative, per-seat)
    const base_per_seat_cents = Math.round(pay.base_cents);
    const tax_per_seat_cents  = Math.round(pay.tax_cents);
    const fees_per_seat_cents = Math.round(pay.fees_cents);
    const unit_price_cents    = Math.round(perSeatFromToken * 100); // same as (base+tax+fees) with compounding already baked in token
    const base_cents_total    = base_per_seat_cents * qty;
    const tax_cents_total     = tax_per_seat_cents * qty;
    const fees_cents_total    = fees_per_seat_cents * qty;
    const total_cents         = Math.round(pay.total_cents);

    // insert order (service role)
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
        tax_cents:  tax_cents_total,
        fees_cents: fees_cents_total,
        total_cents,
        tax_rate: taxRate,
        fees_rate: feesRate,

        // contact mirrors (optional)
        lead_first_name: body.lead_first_name ?? null,
        lead_last_name:  body.lead_last_name ?? null,
        lead_email:      body.lead_email ?? null,
        lead_phone:      body.lead_phone ?? null,
      })
      .select("id, success_token")
      .maybeSingle();

    if (insErr || !inserted) {
      return NextResponse.json({ ok: false, error: insErr?.message || "Order insert failed" }, { status: 500 });
    }

    // passengers (ensure exactly qty rows, one lead)
    type InPax = { first_name?: string; last_name?: string; is_lead?: boolean };
    let pax: InPax[] = Array.isArray(body.passengers) ? body.passengers : [];
    pax = pax.map(p => ({
      first_name: String(p?.first_name ?? "").trim(),
      last_name:  String(p?.last_name  ?? "").trim(),
      is_lead:    Boolean(p?.is_lead),
    })).filter(p => p.first_name || p.last_name);

    // normalize lead
    const leadIdxs = pax.map((p, i) => (p.is_lead ? i : -1)).filter(i => i >= 0);
    if (leadIdxs.length === 0 && pax.length > 0) pax[0].is_lead = true;
    if (leadIdxs.length > 1) {
      const keep = leadIdxs[0];
      pax = pax.map((p, i) => ({ ...p, is_lead: i === keep }));
    }

    // build rows, pad to qty
    const paxRows: Array<{ order_id: string; first_name: string | null; last_name: string | null; is_lead: boolean }> = [];
    for (const p of pax) {
      paxRows.push({ order_id: inserted.id, first_name: p.first_name || null, last_name: p.last_name || null, is_lead: !!p.is_lead });
    }
    while (paxRows.length < qty) {
      paxRows.push({ order_id: inserted.id, first_name: "Guest", last_name: null, is_lead: paxRows.length === 0 });
    }
    if (paxRows.length > qty) paxRows.length = qty;

    if (paxRows.length) {
      const { error: paxErr } = await admin.from("order_passengers").insert(paxRows);
      if (paxErr) console.warn("[/api/checkout] order_passengers warning:", paxErr.message);
    }

    // optional: create booking right away (dev)
    let bookingId: string | null = null;
    if (CREATE_BOOKING_IMMEDIATELY) {
      try {
        const journeyId = await ensureJourneyId(routeId!, dateISO!);
        const lead = paxRows.find(p => p.is_lead);
        const customer_name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() || "Guest";

        const { data: booking } = await admin
          .from("bookings")
          .insert({
            route_id: routeId!,
            journey_id: journeyId,
            customer_name,
            seats: qty,
            status: "Scheduled",
            order_id: inserted.id,
            paid_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        bookingId = booking?.id ?? null;

        if (bookingId) await admin.from("orders").update({ status: "paid", booking_id: bookingId }).eq("id", inserted.id);
        else           await admin.from("orders").update({ status: "paid" }).eq("id", inserted.id);
      } catch (e) {
        console.warn("[/api/checkout] dev booking creation skipped:", e);
      }
    }

    // success URL
    const url = `/orders/success2?orderId=${encodeURIComponent(inserted.id)}&s=${encodeURIComponent(inserted.success_token)}`;

    return NextResponse.json({ ok: true, order_id: inserted.id, booking_id: bookingId, url });
  } catch (e: any) {
    console.error("[/api/checkout] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal Server Error" }, { status: 500 });
  }
}
