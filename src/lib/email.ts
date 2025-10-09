// src/lib/email.ts
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

// ---------- ENV ----------
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const FROM_EMAIL = process.env.EMAIL_FROM || "Pace Shuttles <no-reply@paceshuttles.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO || "support@paceshuttles.com";
const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.paceshuttles.com";

// ---------- RESEND ----------
const resend = new Resend(RESEND_API_KEY);

// ---------- SERVER-SIDE SUPABASE ----------
function serverSB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

// ---------- Types (partial, just what we read) ----------
type UUID = string;

type OrderRow = {
  id: UUID;
  status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired";
  currency: string;
  total_cents: number;
  route_id: UUID | null;
  journey_date: string | null; // YYYY-MM-DD
  qty: number | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  success_token: UUID;
};

type RouteRow = {
  id: UUID;
  route_name: string | null;
  pickup_id: UUID | null;
  destination_id: UUID | null;
  pickup_time: string | null; // HH:mm
  transport_type: string | null;
  countries?: { timezone?: string | null } | null;
};

type PickupRow = {
  id: UUID;
  name: string;
};

type DestinationRow = {
  id: UUID;
  name: string;
  url: string | null;
  email: string | null;
  phone: string | null;
  wet_or_dry: "wet" | "dry" | null;
  gift: string | null;
};

type JourneyRow = {
  id: UUID;
  departure_ts: string; // ISO
  vehicle_id: UUID | null;
};

type VehicleRow = {
  id: UUID;
  name: string | null;
  type_id: UUID | null;
};

type TransportTypeRow = {
  id: UUID;
  name: string;
};

// ---------- helpers ----------
function poundsInt(cents: number, ccy: string) {
  if (!Number.isFinite(cents)) return "—";
  if (ccy.toUpperCase() === "GBP") {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
      Math.round(cents) / 100
    );
  }
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy.toUpperCase() }).format(
      Math.round(cents) / 100
    );
  } catch {
    return `£${(Math.round(cents) / 100).toFixed(2)}`;
  }
}

function fmtDate(dISO: string, tz?: string | null, lang?: string) {
  const d = new Date(dISO);
  return new Intl.DateTimeFormat(lang || undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz || "UTC",
  }).format(d);
}

function fmtTimeLocal(hhmm?: string | null, lang?: string) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(lang || undefined, { hour: "2-digit", minute: "2-digit" });
}

function esc(x: string | null | undefined) {
  return (x || "").trim();
}

// ---------- Email assembly ----------
function buildEmail({
  order,
  route,
  pickup,
  destination,
  journey,
  vehicle,
  transportType,
}: {
  order: OrderRow;
  route: RouteRow | null;
  pickup: PickupRow | null;
  destination: DestinationRow | null;
  journey: JourneyRow | null;
  vehicle: VehicleRow | null;
  transportType: TransportTypeRow | null;
}) {
  const leadFirst = esc(order.lead_first_name) || "Guest";
  const routeName =
    esc(route?.route_name) ||
    `${esc(pickup?.name) || "Pick-up"} → ${esc(destination?.name) || "Destination"}`;

  const vehicleType = esc(transportType?.name) || esc(route?.transport_type) || "Shuttle";
  const journeyDateISO =
    order.journey_date ? `${order.journey_date}T12:00:00Z` : journey?.departure_ts || "";
  const tz = route?.countries?.timezone || "UTC";
  const dateHuman = journeyDateISO ? fmtDate(journeyDateISO, tz) : (order.journey_date || "—");
  const timeHuman = fmtTimeLocal(route?.pickup_time, undefined);
  const amount = poundsInt(order.total_cents, order.currency || "GBP");
  const pickupName = esc(pickup?.name) || "Pick-up";
  const destName = esc(destination?.name) || "Destination";

  const wetBlock =
    (destination?.wet_or_dry || "dry") === "wet"
      ? `
This journey doesn’t have a fixed mooring at the destination and so you will likely get wet when exiting the boat. Please bring a towel and appropriate clothing.`
      : "";

  const giftBlock = destination?.gift
    ? `\nGift for Pace Shuttles' Guests: ${destination.gift}\n`
    : "";

  // No receipt yet → point to Account page
  const receiptLine =
    "You can find your booking details and confirmation on your account page on www.paceshuttles.com.";

  const lines = [
    `Dear ${leadFirst}`,
    ``,
    `Order Ref: ${order.id}`,
    ``,
    `This is confirmation of your booking of a return ${vehicleType} trip between ${routeName} on ${dateHuman} at ${timeHuman}.`,
    ``,
    `We have received your payment of ${amount}. ${receiptLine}`,
    ``,
    wetBlock.trim(),
    wetBlock ? `` : ``,
    `Your journey will leave from ${pickupName}. Please arrive at least 10 minutes before departure time. Google map direction to ${pickupName} are available here.`,
    ``,
    `Just to remind you, Pace Shuttles have not made any reservations or arrangements for you and your party at ${destName}. If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.`,
    ``,
    `You can contact ${destName} in the following ways:`,
    esc(destination?.url) || "—",
    esc(destination?.email) || "—",
    esc(destination?.phone) || "—",
    ``,
    `We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fayre.`,
    ``,
    `Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.`,
    ``,
    `The Pace Shuttles Team`,
  ].filter(Boolean);

  const text = lines.join("\n");

  // Minimal HTML (keep it simple for providers)
  const html = `
  <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
    <p>Dear ${leadFirst}</p>
    <p><strong>Order Ref:</strong> ${order.id}</p>
    <p>This is confirmation of your booking of a return <strong>${vehicleType}</strong> trip between <strong>${routeName}</strong> on <strong>${dateHuman}</strong> at <strong>${timeHuman}</strong>.</p>
    <p>We have received your payment of <strong>${amount}</strong>. ${receiptLine}</p>
    ${wetBlock ? `<p>${wetBlock}</p>` : ""}
    <p>Your journey will leave from <strong>${pickupName}</strong>. Please arrive at least 10 minutes before departure time. Google map direction to ${pickupName} are available here.</p>
    <p>Just to remind you, Pace Shuttles have not made any reservations or arrangements for you and your party at <strong>${destName}</strong>. If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.</p>
    ${giftBlock ? `<p>${giftBlock}</p>` : ""}
    <p>You can contact ${destName} in the following ways:<br/>
      ${destination?.url ? `<a href="${destination.url}">${destination.url}</a><br/>` : "—<br/>"}
      ${destination?.email ? `<a href="mailto:${destination.email}">${destination.email}</a><br/>` : "—<br/>"}
      ${destination?.phone ? `<a href="tel:${destination.phone}">${destination.phone}</a>` : "—"}
    </p>
    <p>We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fayre.</p>
    <p>Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.</p>
    <p>The Pace Shuttles Team</p>
  </div>
  `.trim();

  const subject = `Your Pace Shuttles booking — ${routeName} on ${dateHuman}`;

  const toEmail = esc(order.lead_email) || ""; // must exist (enforced on the pay page)
  return { toEmail, subject, text, html };
}

// ---------- Public function you can call on payment success ----------
export async function sendBookingPaidEmail(orderId: UUID) {
  const supa = serverSB();

  // Pull the order (must be paid)
  const { data: order, error: oErr } = await supa
    .from("orders")
    .select(
      [
        "id",
        "status",
        "currency",
        "total_cents",
        "route_id",
        "journey_date",
        "qty",
        "lead_first_name",
        "lead_last_name",
        "lead_email",
        "lead_phone",
        "success_token",
      ].join(",")
    )
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (oErr) throw oErr;
  if (!order) throw new Error("Order not found");
  if (order.status !== "paid") {
    throw new Error(`Order ${orderId} is not paid (status=${order.status})`);
  }

  // Route + joins
  const { data: route } = await supa
    .from("routes")
    .select(
      "id, route_name, pickup_id, destination_id, pickup_time, transport_type, countries(timezone)"
    )
    .eq("id", order.route_id)
    .maybeSingle<RouteRow>();

  const { data: pickup } = await supa
    .from("pickup_points")
    .select("id,name")
    .eq("id", route?.pickup_id || "")
    .maybeSingle<PickupRow>();

  const { data: destination } = await supa
    .from("destinations")
    .select("id,name,url,email,phone,wet_or_dry,gift")
    .eq("id", route?.destination_id || "")
    .maybeSingle<DestinationRow>();

  // Find journey for that route/day (if exists)
  const { data: journey } = await supa
    .from("journeys")
    .select("id,departure_ts,vehicle_id")
    .eq("route_id", order.route_id)
    .gte("departure_ts", `${order.journey_date}T00:00:00Z`)
    .lte("departure_ts", `${order.journey_date}T23:59:59Z`)
    .maybeSingle<JourneyRow>();

  const { data: vehicle } = journey?.vehicle_id
    ? await supa
        .from("vehicles")
        .select("id,name,type_id")
        .eq("id", journey.vehicle_id)
        .maybeSingle<VehicleRow>()
    : { data: null };

  const { data: transportType } =
    vehicle?.type_id
      ? await supa
          .from("transport_types")
          .select("id,name")
          .eq("id", vehicle.type_id)
          .maybeSingle<TransportTypeRow>()
      : { data: null };

  const { toEmail, subject, text, html } = buildEmail({
    order,
    route: route || null,
    pickup: pickup || null,
    destination: destination || null,
    journey: journey || null,
    vehicle: vehicle || null,
    transportType: transportType || null,
  });

  if (!toEmail) throw new Error("Lead email missing on order");

  // Send via Resend
  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: [toEmail],
    replyTo: REPLY_TO,
    subject,
    text,
    html,
  });

  if (error) throw error;

  return { ok: true };
}
