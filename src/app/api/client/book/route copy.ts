// src/app/api/client/book/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/* ---------- Env ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const QUOTE_SECRET = process.env.QUOTE_SIGNING_SECRET!;
const CREATE_BOOKING_IMMEDIATELY = process.env.CREATE_BOOKING_IMMEDIATELY === "true";

/* ---------- Helpers ---------- */
const r2 = (n: number) => Math.round(n * 100) / 100;
const asFraction = (x: unknown): number => {
  let n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1) n = n / 100;
  if (n > 1) n = 1;
  return n;
};

function sign(payload: object) {
  const msg = JSON.stringify(payload);
  return crypto.createHmac("sha256", QUOTE_SECRET).update(msg).digest("hex");
}
function verify(payload: object, sig: string) {
  try {
    const expected = sign(payload);
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function ensureJourneyId(routeId: string, dateISO: string): Promise<string | null> {
  try {
    const { data, error } = await admin().rpc("ps_ensure_journey", {
      p_route_id: routeId,
      p_day: dateISO,
    });
    if (error) throw error;
    return data as string;
  } catch {
    const { data } = await admin()
      .from("journeys")
      .select("id")
      .eq("route_id", routeId)
      .gte("departure_ts", `${dateISO}T00:00:00.000Z`)
      .lt("departure_ts", `${dateISO}T23:59:59.999Z`)
      .limit(1);
    return data?.[0]?.id ?? null;
  }
}

/* ---------- Route ---------- */
export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON || !SERVICE_KEY || !QUOTE_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Server env not configured" },
        { status: 500 }
      );
    }

    // Read from body AND querystring (querystring is a safe fallback)
    const body = await req.json().catch(() => ({} as any));
    const qs = req.nextUrl.searchParams;

    const pick = <T = string>(...keys: string[]): T | null => {
      for (const k of keys) {
        const vBody = body?.[k];
        if (vBody != null && vBody !== "") return vBody as T;
        const vQs = qs.get(k);
        if (vQs != null && vQs !== "") return vQs as unknown as T;
      }
      return null;
    };

    // 1) Auth (require a user)
    const jar = await cookies();
    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (k) => jar.get(k)?.value,
        set: (k, v, o) => jar.set(k, v, o),
        remove: (k, o) => jar.set(k, "", { ...o, maxAge: 0 }),
      },
    });
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) {
      return NextResponse.json({ ok: false, error: "Auth required" }, { status: 401 });
    }
    const userId = auth.user.id;

    // 2) Hydrate order facts (prefer qid)
    let routeId: string | null = null;
    let dateISO: string | null = null;
    let qty: number | null = null;
    let allInUnits: number | null = null; // per-seat in currency UNITS
    let token: string | null = null;
    let currency: string = String(pick("ccy") || "GBP").toUpperCase();

    const qid = pick("qid");
    if (qid) {
      const { data: qi } = await admin()
        .from("quote_intents")
        .select("route_id,date_iso,seats,per_seat_all_in,quote_token,currency")
        .eq("id", String(qid))
        .maybeSingle();

      if (qi) {
        routeId = qi.route_id;
        dateISO = qi.date_iso;
        qty = Math.max(1, Number(qi.seats || 1));
        allInUnits = Number(qi.per_seat_all_in);
        token = qi.quote_token;
        if (qi.currency) currency = String(qi.currency).toUpperCase();
      }
      // If qid provided but not found, we still allow explicit fallbacks below.
    }

    // explicit fallbacks (body or querystring)
    routeId = routeId ?? (pick("routeId", "route_id") as string | null);
    dateISO = dateISO ?? (pick("date") as string | null);
    qty = qty ?? Math.max(1, Number(pick("qty", "seats") ?? 0));
    token = token ?? (pick("token", "quoteToken") as string | null);

    // price field variants: allInC (units) or perSeatAllIn (units)
    const explicitAllIn =
      pick("allInC") ??
      pick("perSeatAllIn") ??
      pick("all_in_c") ??
      pick("per_seat_all_in");

    allInUnits = allInUnits ?? (explicitAllIn != null ? Number(explicitAllIn) : null);

    if (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInUnits)) {
      return NextResponse.json(
        { ok: false, error: "Invalid request: route/date/qty/price required" },
        { status: 400 }
      );
    }

    // 3) Verify quote signature
    const valid = verify(
      { routeId, date: dateISO, qty, allInC: allInUnits },
      String(token)
    );
    if (!valid) {
      return NextResponse.json(
        { ok: false, error: "Quote token invalid/expired" },
        { status: 400 }
      );
    }

    // 4) Snapshot tax/fees
    const { data: tf } = await admin()
      .from("tax_fees")
      .select("tax,fees")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const taxRate = asFraction(tf?.tax ?? 0);
    const feesRate = asFraction(tf?.fees ?? 0);

    // 5) Decompose all-in per-seat into base/tax/fees (compounded)
    const denom = 1 + taxRate + feesRate + taxRate * feesRate;
    const basePerSeat = denom ? r2(allInUnits / denom) : 0;
    const taxPerSeat = r2(basePerSeat * taxRate);
    const feesPerSeat = r2((basePerSeat + taxPerSeat) * feesRate);

    // 6) Cents
    const unit_price_cents = Math.round(allInUnits * 100);
    const base_cents_total = Math.round(basePerSeat * 100) * qty;
    const tax_cents_total = Math.round(taxPerSeat * 100) * qty;
    const fees_cents_total = Math.round(feesPerSeat * 100) * qty;
    const total_cents = unit_price_cents * qty;

    // 7) Create order
    const { data: order, error: insErr } = await admin()
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
        tax_rate: taxRate,
        fees_rate: feesRate,

        // optional lead/contact (mirrored below if passengers[] present)
        lead_first_name: body.lead_first_name ?? pick("lead_first_name"),
        lead_last_name: body.lead_last_name ?? pick("lead_last_name"),
        lead_email: body.lead_email ?? pick("lead_email"),
        lead_phone: body.lead_phone ?? pick("lead_phone"),
      })
      .select("id,success_token")
      .maybeSingle();

    if (insErr || !order) {
      return NextResponse.json(
        { ok: false, error: insErr?.message || "Order insert failed" },
        { status: 500 }
      );
    }

    // 8) Passengers (lead + additional) — exactly as before
    type PaxIn = { first_name?: string; last_name?: string; is_lead?: boolean };
    const paxRaw: PaxIn[] = Array.isArray(body.passengers)
      ? body.passengers
      : JSON.parse((qs.get("passengers") ?? "[]"));

    let pax = paxRaw
      .map((p) => ({
        first_name: String(p?.first_name ?? "").trim(),
        last_name: String(p?.last_name ?? "").trim(),
        is_lead: !!p?.is_lead,
      }))
      .filter((p) => p.first_name || p.last_name);

    // Ensure exactly one lead
    const leadIdxs = pax.map((p, i) => (p.is_lead ? i : -1)).filter((i) => i >= 0);
    if (leadIdxs.length === 0 && pax.length > 0) pax[0].is_lead = true;
    if (leadIdxs.length > 1) {
      const keep = leadIdxs[0];
      pax = pax.map((p, i) => ({ ...p, is_lead: i === keep }));
    }

    // Mirror chosen lead onto orders table if provided
    const li = pax.findIndex((p) => p.is_lead);
    if (li >= 0) {
      await admin()
        .from("orders")
        .update({
          lead_first_name: pax[li].first_name || null,
          lead_last_name: pax[li].last_name || null,
        })
        .eq("id", order.id);
    }

    // Ensure passengers count = qty
    const paxRows = pax.map((p) => ({
      order_id: order.id,
      first_name: p.first_name || null,
      last_name: p.last_name || null,
      is_lead: !!p.is_lead,
    }));
    while (paxRows.length < qty) {
      paxRows.push({
        order_id: order.id,
        first_name: "Guest",
        last_name: null,
        is_lead: paxRows.length === 0,
      });
    }
    if (paxRows.length > qty) paxRows.length = qty;

    if (paxRows.length) {
      const { error: paxErr } = await admin().from("order_passengers").insert(paxRows);
      if (paxErr) console.warn("[book] order_passengers warning:", paxErr.message);
    }

    // 9) Dev helper: create booking now (optional)
    if (CREATE_BOOKING_IMMEDIATELY) {
      try {
        const journeyId = await ensureJourneyId(routeId, dateISO);
        const lead = paxRows.find((p) => p.is_lead);
        const customer_name = [lead?.first_name, lead?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || "Guest";

        const { data: booking } = await admin()
          .from("bookings")
          .insert({
            route_id: routeId,
            journey_id: journeyId,
            customer_name,
            seats: qty,
            status: "Scheduled",
            order_id: order.id,
            paid_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (booking?.id) {
          await admin().from("orders").update({ status: "paid", booking_id: booking.id }).eq("id", order.id);
        } else {
          await admin().from("orders").update({ status: "paid" }).eq("id", order.id);
        }
      } catch (e) {
        console.warn("[book] dev booking creation skipped:", e);
      }
    }

    // 10) Receipt
    const url = `/orders/success2?orderId=${encodeURIComponent(order.id)}&s=${encodeURIComponent(
      order.success_token
    )}`;
    return NextResponse.json({ ok: true, order_id: order.id, url }, { status: 200 });
  } catch (e: any) {
    console.error("[/api/client/book] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
