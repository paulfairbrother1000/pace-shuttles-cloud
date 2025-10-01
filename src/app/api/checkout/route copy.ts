// src/app/api/checkout/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/** ---------- Env ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only
const QUOTE_SECRET = process.env.QUOTE_SIGNING_SECRET!;
const CREATE_BOOKING_IMMEDIATELY = process.env.CREATE_BOOKING_IMMEDIATELY === "true";

/** ---------- Helpers ---------- */
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
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Accept 0.2 or 20 for “20%”; clamp to [0,1] */
function asFraction(x: unknown): number {
  let n = Number(x ?? 0);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1) n = n / 100;
  if (n > 1) n = 1;
  return n;
}

/** Admin Supabase client (service role) */
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function ensureJourneyId(routeId: string, dateISO: string): Promise<string | null> {
  // Prefer calling a helper SQL function if present.
  try {
    const { data, error } = await sbAdmin().rpc("ps_ensure_journey", {
      p_route_id: routeId,
      p_day: dateISO,
    });
    if (error) throw error;
    return data as string;
  } catch {
    // Fallback: find an existing journey on that date.
    const { data } = await sbAdmin()
      .from("journeys")
      .select("id")
      .eq("route_id", routeId)
      .gte("departure_ts", `${dateISO}T00:00:00.000Z`)
      .lt("departure_ts", `${dateISO}T23:59:59.999Z`)
      .limit(1);
    return data?.[0]?.id ?? null;
  }
}

/** ---------- POST /api/checkout ---------- */
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

    // Required payload
    const routeId: string = body.routeId || body.route_id;
    const dateISO: string = body.date;
    const qty: number = Math.max(1, Number(body.qty ?? body.seats ?? 1));
    const token: string = body.token || body.quoteToken;
    const allInUnits: number = Number(body.allInC ?? body.perSeatAllIn); // per-seat in currency UNITS
    const currency: string = (body.ccy || "GBP").toUpperCase();

    if (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInUnits)) {
      return NextResponse.json({ ok: false, error: "Missing route/date/qty/token/price" }, { status: 400 });
    }

    // Verify signed quote (SSOT: routeId, date, qty, allInC)
    const isValid = verify({ routeId, date: dateISO, qty, allInC: allInUnits }, token);
    if (!isValid) {
      return NextResponse.json({ ok: false, error: "Quote token invalid/expired" }, { status: 400 });
    }

    // Require authenticated user (no guest fallback)
    const jar = await cookies();
    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => {
          jar.set(name, value, options);
        },
        remove: (name, options) => {
          jar.set(name, "", { ...options, maxAge: 0 });
        },
      },
    });
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) {
      return NextResponse.json({ ok: false, error: "Auth required" }, { status: 401 });
    }
    const userId = auth.user.id;

    // Snapshot tax/fees (optional table)
    const { data: tf } = await sb
      .from("tax_fees")
      .select("tax,fees")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const taxRate = asFraction(tf?.tax ?? 0);
    const feesRate = asFraction(tf?.fees ?? 0);

    // Split the all-in per-seat amount into base/tax/fees (compounded)
    const denom = 1 + taxRate + feesRate + taxRate * feesRate;
    const basePerSeat = denom ? r2(allInUnits / denom) : 0;
    const taxPerSeat = r2(basePerSeat * taxRate);
    const feesPerSeat = r2((basePerSeat + taxPerSeat) * feesRate);

    // Convert to cents (integers)
    const unit_price_cents = Math.round(allInUnits * 100);
    const base_cents_total = Math.round(basePerSeat * 100) * qty;
    const tax_cents_total = Math.round(taxPerSeat * 100) * qty;
    const fees_cents_total = Math.round(feesPerSeat * 100) * qty;
    const total_cents = unit_price_cents * qty;

    // -------- INSERT ORDER using SERVICE-ROLE (bypass RLS but still require login) --------
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
        tax_rate: taxRate,
        fees_rate: feesRate,

        // optional lead/contact fields
        lead_first_name: body.lead_first_name ?? null,
        lead_last_name: body.lead_last_name ?? null,
        lead_email: body.lead_email ?? null,
        lead_phone: body.lead_phone ?? null,

        home_addr_line1: body.home_addr_line1 ?? null,
        home_addr_line2: body.home_addr_line2 ?? null,
        home_city: body.home_city ?? null,
        home_region: body.home_region ?? null,
        home_postal: body.home_postal ?? null,
        home_country: body.home_country ?? null,

        bill_addr_line1: body.bill_addr_line1 ?? null,
        bill_addr_line2: body.bill_addr_line2 ?? null,
        bill_city: body.bill_city ?? null,
        bill_region: body.bill_region ?? null,
        bill_postal: body.bill_postal ?? null,
        bill_country: body.bill_country ?? null,

        card_last4: body.card_last4 ?? null,
      })
      .select("id, success_token")
      .maybeSingle();

    if (insErr || !inserted) {
      return NextResponse.json(
        { ok: false, error: insErr?.message || "Order insert failed" },
        { status: 500 }
      );
    }

    // -------- DEV ONLY: create booking immediately so operator admin updates --------
    if (CREATE_BOOKING_IMMEDIATELY) {
      try {
        const journeyId = await ensureJourneyId(routeId, dateISO);
        const customer_name =
          [body.lead_first_name, body.lead_last_name].filter(Boolean).join(" ").trim() || "Guest";

        const { data: booking } = await admin
          .from("bookings")
          .insert({
            route_id: routeId,
            journey_id: journeyId, // may be null if not found/created
            customer_name,
            seats: qty,
            status: "Scheduled",
            order_id: inserted.id,
            paid_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (booking?.id) {
          await admin
            .from("orders")
            .update({ status: "paid", booking_id: booking.id })
            .eq("id", inserted.id);
        }
      } catch (e) {
        // Don't fail checkout in dev if booking insert has issues
        console.warn("[checkout] dev booking creation skipped:", e);
      }
    }

    // Receipt URL
    const url = `/orders/success2?orderId=${encodeURIComponent(inserted.id)}&s=${encodeURIComponent(
      inserted.success_token
    )}`;

    return NextResponse.json({
      ok: true,
      order_id: inserted.id,
      success_token: inserted.success_token,
      url,
    });
  } catch (e: any) {
    console.error("[/api/checkout] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal Server Error" }, { status: 500 });
  }
}
