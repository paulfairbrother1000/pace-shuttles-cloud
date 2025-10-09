// src/lib/email.ts
// Node-only; called from server routes (e.g. /api/checkout)
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";

/** ENV (required) */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Resend (REST API — no SDK needed)
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_FROM = process.env.RESEND_FROM || "Pace Shuttles <bookings@paceshuttles.com>";

/** Supabase admin client (server) */
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/** Helpers */
function toMapsUrl(parts: Array<string | null | undefined>): string {
  const q = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
function isWetTrip(wet_or_dry?: string | null) {
  return (wet_or_dry || "").toLowerCase() === "wet";
}
function fmtMoney(n: number, ccy: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy }).format(n);
}

/** Compose the email (HTML + text) from database entities */
async function buildEmailForOrder(orderId: string) {
  const admin = sbAdmin();

  // Order (source of truth for recipient + amounts)
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select(`
      id, status, currency, total_amount_c, total_cents,
      route_id, journey_date, qty,
      lead_first_name, lead_last_name, lead_email, lead_phone
    `)
    .eq("id", orderId)
    .maybeSingle();
  if (oErr || !order) throw oErr || new Error("Order not found");
  if (!order.lead_email) throw new Error("Order has no lead email");

  // Route + endpoints
  const { data: route, error: rErr } = await admin
    .from("routes")
    .select(`id, route_name, pickup_id, destination_id, transport_type`)
    .eq("id", order.route_id)
    .maybeSingle();
  if (rErr || !route) throw rErr || new Error("Route not found");

  const [{ data: pickup }, { data: dest }] = await Promise.all([
    admin
      .from("pickup_points")
      .select(`id, name, address1, address2, town, region`)
      .eq("id", route.pickup_id)
      .maybeSingle(),
    admin
      .from("destinations")
      .select(`id, name, url, email, phone, wet_or_dry, arrival_notes`)
      .eq("id", route.destination_id)
      .maybeSingle(),
  ]);

  // Find a departure time (best-effort) from journeys for that day
  let departure_ts: string | null = null;
  if (order.journey_date) {
    const { data: j } = await admin
      .from("journeys")
      .select("departure_ts")
      .eq("route_id", route.id)
      .gte("departure_ts", `${order.journey_date}T00:00:00Z`)
      .lt("departure_ts", `${order.journey_date}T23:59:59Z`)
      .order("departure_ts", { ascending: true })
      .limit(1)
      .maybeSingle();
    departure_ts = j?.departure_ts ?? null;
  }

  // Labels
  const dt = departure_ts ? new Date(departure_ts) : null;
  const journeyDate = order.journey_date || (dt ? dt.toISOString().slice(0, 10) : "—");
  const journeyTime = dt ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const ccy = order.currency || "GBP";

  const paymentAmount =
    typeof order.total_amount_c === "number"
      ? order.total_amount_c
      : ((order.total_cents || 0) / 100);

  const paymentAmountLabel = fmtMoney(paymentAmount, ccy);

  const pickupMaps = toMapsUrl([
    pickup?.name,
    pickup?.address1,
    pickup?.address2,
    pickup?.town,
    pickup?.region,
  ]);

  const wetAdvice = isWetTrip(dest?.wet_or_dry)
    ? (dest?.arrival_notes?.trim() ||
       "This journey doesn’t have a fixed mooring at the destination and so you may get wet when exiting the boat. Please bring a towel and appropriate clothing.")
    : "";

  // Subject
  const subject = `Pace Shuttles – Booking Confirmation (${order.id})`;

  // Body (TEXT)
  const text = [
    `Dear ${order.lead_first_name || ""}`,
    ``,
    `Order Ref: ${order.id}`,
    ``,
    `This is confirmation of your booking of a return ${route.transport_type || "shuttle"} trip between ${route.route_name || ""} on ${journeyDate} at ${journeyTime}.`,
    ``,
    `We have received your payment of ${paymentAmountLabel}. You can find your booking details and confirmation on your account page on www.paceshuttles.com.`,
    ``,
    wetAdvice ? wetAdvice : "",
    wetAdvice ? "" : "",
    `Your journey will leave from ${pickup?.name || "the departure point"}. Please arrive at least 10 minutes before departure time. Google map directions are available here: ${pickupMaps}`,
    ``,
    `Just to remind you, Pace Shuttles have not made any reservations or arrangements for you and your party at ${dest?.name || "the destination"}. If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.`,
    ``,
    `You can contact ${dest?.name || "the destination"} in the following ways:`,
    dest?.url ? dest.url : "",
    dest?.email ? String(dest.email) : "",
    dest?.phone ? String(dest.phone) : "",
    ``,
    `We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fare.`,
    ``,
    `Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.`,
    ``,
    `The Pace Shuttles Team`,
  ]
    .filter(Boolean)
    .join("\n");

  // Body (HTML)
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
    <p>Dear ${escapeHtml(order.lead_first_name || "")}</p>

    <p><strong>Order Ref:</strong> ${escapeHtml(order.id)}</p>

    <p>
      This is confirmation of your booking of a return
      <strong>${escapeHtml(route.transport_type || "shuttle")}</strong> trip between
      <strong>${escapeHtml(route.route_name || "")}</strong> on
      <strong>${escapeHtml(journeyDate)}</strong> at <strong>${escapeHtml(journeyTime)}</strong>.
    </p>

    <p>
      We have received your payment of <strong>${escapeHtml(paymentAmountLabel)}</strong>.
      You can find your booking details and confirmation on your account page on
      <a href="https://www.paceshuttles.com" target="_blank" rel="noopener">www.paceshuttles.com</a>.
    </p>

    ${
      wetAdvice
        ? `<p style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px"><strong>Wet trip advice:</strong> ${escapeHtml(
            wetAdvice
          )}</p>`
        : ""
    }

    <p>
      Your journey will leave from <strong>${escapeHtml(pickup?.name || "the departure point")}</strong>.
      Please arrive at least 10 minutes before departure time.
      <a href="${pickupMaps}" target="_blank" rel="noopener">Google map directions</a>.
    </p>

    <p>
      Just to remind you, Pace Shuttles have not made any reservations or arrangements for you and your party at
      <strong>${escapeHtml(dest?.name || "the destination")}</strong>.
      If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.
    </p>

    <p>You can contact <strong>${escapeHtml(dest?.name || "the destination")}</strong> in the following ways:<br/>
      ${dest?.url ? `<a href="${escapeAttr(dest.url)}" target="_blank" rel="noopener">${escapeHtml(dest.url)}</a><br/>` : ""}
      ${dest?.email ? `${escapeHtml(String(dest.email))}<br/>` : ""}
      ${dest?.phone ? `${escapeHtml(String(dest.phone))}<br/>` : ""}
    </p>

    <p>
      We shall contact you the day before departure to confirm arrangements.
      In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control,
      we shall confirm this with you and fully refund your fare.
    </p>

    <p>Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.</p>

    <p>— The Pace Shuttles Team</p>
  </div>`.trim();

  return {
    to: order.lead_email as string,
    subject,
    html,
    text,
  };
}

/** Minimal HTML escapers (avoid XSS in emails) */
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** Send email via Resend REST API (no SDK) */
async function sendViaResend(opts: { to: string; subject: string; html: string; text: string }) {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY missing; skipping send.");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${msg}`);
  }
}

/**
 * Public API used by /api/checkout (or future payment webhooks):
 * Sends the "booking paid" email to the lead passenger.
 */
export async function sendBookingPaidEmail(orderId: string): Promise<void> {
  const built = await buildEmailForOrder(orderId);
  await sendViaResend(built);
}
