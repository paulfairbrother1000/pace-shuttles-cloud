// src/lib/email.ts
// Node-only; called from server routes (e.g. /api/checkout)
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";
import { renderBookingEmailHTML, renderBookingEmailText, BookingEmailData } from "./email/templates";

/** ENV (required) */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Resend (REST API — no SDK needed)
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_FROM = process.env.RESEND_FROM || "Pace Shuttles <bookings@paceshuttles.com>";

// Base site URL for deep-links to pickup/destination detail pages
const SITE_BASE =
  (process.env.NEXT_PUBLIC_SITE_URL || "https://www.paceshuttles.com").replace(/\/+$/, "");

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

/** Compose all data needed for the email template */
async function buildEmailForOrder(orderId: string): Promise<{
  to: string;
  subject: string;
  html: string;
  text: string;
}> {
  const admin = sbAdmin();

  // 1) Order (source of truth for recipient + amounts)
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

  // 2) Route + endpoints
  const { data: route, error: rErr } = await admin
    .from("routes")
    .select(`id, route_name, pickup_id, destination_id, transport_type`)
    .eq("id", order.route_id)
    .maybeSingle();
  if (rErr || !route) throw rErr || new Error("Route not found");

  const [{ data: pickup }, { data: dest }] = await Promise.all([
    admin
      .from("pickup_points")
      .select(`id, country_id, name, address1, address2, town, region`)
      .eq("id", route.pickup_id)
      .maybeSingle(),
    admin
      .from("destinations")
      .select(`id, country_id, name, url, email, phone, wet_or_dry, arrival_notes`)
      .eq("id", route.destination_id)
      .maybeSingle(),
  ]);

  // 3) Country (prefer pickup.country_id; fallback to destination.country_id)
  let countryName = "";
  const countryId = (pickup as any)?.country_id ?? (dest as any)?.country_id ?? null;
  if (countryId) {
    const { data: countryRow } = await admin
      .from("countries")
      .select("name")
      .eq("id", countryId)
      .maybeSingle();
    countryName = countryRow?.name || "";
  }

  // 4) Best-effort departure time (from journeys for that day)
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

  // 5) Labels (server-side: default to en-GB)
  const dt = departure_ts ? new Date(departure_ts) : null;
  const journeyDateISO = order.journey_date || (dt ? dt.toISOString().slice(0, 10) : "");
  const dateLabel = journeyDateISO
    ? new Date(journeyDateISO + "T12:00:00Z").toLocaleDateString("en-GB")
    : "";
  const timeLabel = dt
    ? dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : "";

  // 6) Amounts
  const ccy = order.currency || "GBP";
  const paymentAmount =
    typeof order.total_amount_c === "number"
      ? order.total_amount_c
      : ((order.total_cents || 0) / 100);
  const paymentAmountLabel = fmtMoney(paymentAmount, ccy);

  // 7) Maps + detail links
  const pickupMapsUrl = toMapsUrl([
    pickup?.name,
    pickup?.address1,
    pickup?.address2,
    pickup?.town,
    pickup?.region,
  ]);
  const pickupPageUrl = pickup?.id ? `${SITE_BASE}/pickups/${pickup.id}` : "";
  const destinationPageUrl = dest?.id ? `${SITE_BASE}/destinations/${dest.id}` : "";

  // 8) Wet-trip guidance
  const isWet = isWetTrip(dest?.wet_or_dry);
  const wetAdviceFromDestination = isWet
    ? (dest?.arrival_notes?.trim() ||
       "This journey doesn’t have a fixed mooring at the destination and so you may get wet when exiting the boat. Please bring a towel and appropriate clothing.")
    : "";

  // 9) Template input
  const data: BookingEmailData = {
    orderRef: order.id,
    leadFirst: order.lead_first_name || "",
    vehicleType: route.transport_type || "shuttle",
    routeName: route.route_name || "",
    countryName,
    journeyDateISO,
    dateLabel,
    timeLabel,
    paymentAmountLabel,

    pickupId: pickup?.id || "",
    pickupName: pickup?.name || "",
    pickupPageUrl,
    pickupMapsUrl,

    destinationId: dest?.id || "",
    destinationName: dest?.name || "",
    destinationPageUrl,
    destinationUrl: dest?.url || "",
    destinationEmail: dest?.email || "",
    destinationPhone: dest?.phone || "",

    isWet,
    wetAdviceFromDestination,

    logoUrl: `${SITE_BASE}/pace-logo-email.png`,
  };

  const subject = `Pace Shuttles – Booking Confirmation (${data.orderRef})`;
  const html = renderBookingEmailHTML(data);
  const text = renderBookingEmailText(data);

  return {
    to: order.lead_email as string,
    subject,
    html,
    text,
  };
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
