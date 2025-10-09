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
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.paceshuttles.com";

/** Supabase admin client (server) */
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/** Helpers */
function fmtMoney(n: number, ccy: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy }).format(n);
}
function toMapsUrl(parts: Array<string | null | undefined>): string {
  const q = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
function isWetTrip(wet_or_dry?: string | null) {
  return (wet_or_dry || "").toLowerCase() === "wet";
}
const esc = (s: string) =>
  (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

/** Send email via Resend REST API (no SDK) */
async function sendViaResend(opts: { to: string; subject: string; html: string; text?: string }) {
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
      text: opts.text || "",
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${msg}`);
  }
}

/* =========================================================
 *  A) Customer: “Booking paid” email (unchanged API)
 * =======================================================*/
export async function sendBookingPaidEmail(orderId: string): Promise<void> {
  const admin = sbAdmin();

  // Order (source of truth)
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
    .select(`id, route_name, pickup_id, destination_id, transport_type, country_id`)
    .eq("id", order.route_id)
    .maybeSingle();
  if (rErr || !route) throw rErr || new Error("Route not found");

  const [{ data: pickup }, { data: dest }, { data: country }] = await Promise.all([
    admin.from("pickup_points").select(`id, name, address1, address2, town, region`).eq("id", route.pickup_id).maybeSingle(),
    admin.from("destinations").select(`id, name, url, email, phone, wet_or_dry, arrival_notes`).eq("id", route.destination_id).maybeSingle(),
    admin.from("countries").select(`id, name`).eq("id", route.country_id).maybeSingle(),
  ]);

  // Find departure time
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
  const dt = departure_ts ? new Date(departure_ts) : null;
  const dateLabel = order.journey_date || (dt ? dt.toISOString().slice(0, 10) : "—");
  const timeLabel = dt ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

  const ccy = order.currency || "GBP";
  const paymentAmount =
    typeof order.total_amount_c === "number"
      ? order.total_amount_c
      : ((order.total_cents || 0) / 100);

  const paymentAmountLabel = fmtMoney(paymentAmount, ccy);
  const pickupMaps = toMapsUrl([pickup?.name, pickup?.address1, pickup?.address2, pickup?.town, pickup?.region]);

  // Links to pickup/destination pages
  const pickupPageUrl = `${SITE_URL}/pickups/${pickup?.id ?? ""}`;
  const destPageUrl = `${SITE_URL}/destinations/${dest?.id ?? ""}`;

  // Compose HTML (no repeated “Booking confirmation” header)
  const wetAdvice =
    isWetTrip(dest?.wet_or_dry) && dest?.arrival_notes
      ? `<p style="margin:12px 0; padding:10px; background:#fff7ed; border:1px solid #fdba74; border-radius:8px;">${esc(
          dest.arrival_notes
        )}</p>`
      : "";

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#111; line-height:1.5;">
    <p>Dear ${esc(order.lead_first_name || "")},</p>

    <p>
      This is confirmation of your booking of a return ${esc(route.transport_type || "shuttle")} trip in
      ${esc(country?.name || "—")} between
      <a href="${escAttr(pickupPageUrl)}" target="_blank" rel="noopener">${esc(pickup?.name || "")}</a>
      &rarr;
      <a href="${escAttr(destPageUrl)}" target="_blank" rel="noopener">${esc(dest?.name || "")}</a>
      on ${esc(dateLabel)} at ${esc(timeLabel)}.
    </p>

    <p>
      We have received your payment of ${esc(paymentAmountLabel)}. You can find your booking details and
      confirmation on your account page on
      <a href="${SITE_URL}" target="_blank" rel="noopener">www.paceshuttles.com</a>.
    </p>

    ${wetAdvice}

    <p>
      Your journey will leave from
      <a href="${escAttr(pickupPageUrl)}" target="_blank" rel="noopener">${esc(pickup?.name || "the pick-up point")}</a>.
      Please arrive at least 10 minutes before departure time.
      <a href="${escAttr(pickupMaps)}" target="_blank" rel="noopener">Google Maps directions</a>.
    </p>

    <p>
      Just to remind you, Pace Shuttles <strong>has</strong> not made any reservations or arrangements
      for you and your party at
      <a href="${escAttr(destPageUrl)}" target="_blank" rel="noopener">${esc(dest?.name || "the destination")}</a>.
      If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.
    </p>

    <p>You can contact ${esc(dest?.name || "the destination")} in the following ways:</p>
    <div>
      ${dest?.url ? `<div><strong>Website:</strong> <a href="${escAttr(dest.url)}" target="_blank" rel="noopener">${esc(dest.url)}</a></div>` : ""}
      ${dest?.phone ? `<div><strong>Phone:</strong> ${esc(dest.phone)}</div>` : ""}
      ${dest?.email ? `<div><strong>Email:</strong> <a href="mailto:${escAttr(String(dest.email))}">${esc(String(dest.email))}</a></div>` : ""}
    </div>

    <p>
      We shall contact you the day before departure to confirm arrangements.
      In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control,
      we shall confirm this with you and fully refund your fare.
    </p>

    <p>Once again, thanks for booking with Pace Shuttles — we wish you an enjoyable trip.</p>
    <p>The Pace Shuttles Team</p>
  </div>`.trim();

  const text = [
    `Dear ${order.lead_first_name || ""},`,
    ``,
    `This is confirmation of your booking of a return ${route.transport_type || "shuttle"} trip in ${country?.name || "—"} between ${pickup?.name} -> ${dest?.name} on ${dateLabel} at ${timeLabel}.`,
    ``,
    `We have received your payment of ${paymentAmountLabel}. You can find your booking details and confirmation on your account page on ${SITE_URL}.`,
    ``,
    dest?.arrival_notes ? dest.arrival_notes : "",
    ``,
    `Pickup: ${pickup?.name}. Maps: ${pickupMaps}`,
    ``,
    `Pace Shuttles has not made reservations at ${dest?.name}.`,
    ``,
    `Destination contact:`,
    dest?.url ? `Website: ${dest.url}` : "",
    dest?.phone ? `Phone: ${dest.phone}` : "",
    dest?.email ? `Email: ${dest.email}` : "",
    ``,
    `The Pace Shuttles Team`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendViaResend({
    to: order.lead_email as string,
    subject: `Pace Shuttles – Booking Confirmation (${order.id})`,
    html,
    text,
  });
}

/* =========================================================
 *  B) Operator: “Save the date” email (send once per journey)
 *     Trigger when first booking is created AND T-72 not passed.
 * =======================================================*/
export async function sendOperatorSaveTheDate(journeyId: string): Promise<void> {
  const admin = sbAdmin();

  // De-dupe: bail if we already sent for this journey
  const { data: existing } = await admin
    .from("operator_journey_notices")
    .select("id")
    .eq("journey_id", journeyId)
    .eq("kind", "save_the_date")
    .limit(1);
  if (existing && existing.length) return;

  // Journey + route + vehicle + operator
  const { data: jny, error: jErr } = await admin
    .from("journeys")
    .select("id, departure_ts, route_id, vehicle_id, operator_id")
    .eq("id", journeyId)
    .maybeSingle();
  if (jErr || !jny) throw jErr || new Error("Journey not found");

  // Only before T-72
  const dep = new Date(jny.departure_ts);
  const now = new Date();
  const tMinus72 = new Date(dep.getTime() - 72 * 3600 * 1000);
  if (now >= tMinus72) return;

  const [{ data: route }, { data: vehicle }, { data: operator }, { data: ttype }] =
    await Promise.all([
      admin.from("routes").select("route_name").eq("id", jny.route_id).maybeSingle(),
      admin.from("vehicles").select("id, name, operator_id, type_id").eq("id", jny.vehicle_id).maybeSingle(),
      admin.from("operators").select("id, name, email").eq("id", jny.operator_id).maybeSingle(),
      admin.from("transport_types").select("id, name").eq("id", (await admin.from("vehicles").select("type_id").eq("id", jny.vehicle_id).maybeSingle()).data?.type_id || "").maybeSingle().catch(() => ({ data: null })),
    ]);

  const operatorEmail =
    operator?.email ||
    (await admin.from("operators").select("email").eq("id", vehicle?.operator_id || "").maybeSingle()).data?.email ||
    null;

  if (!operatorEmail) {
    console.warn("[email] Operator email missing for journey", journeyId);
    return;
  }

  // Labels
  const dateLabel = dep.toLocaleDateString("en-GB");
  const timeLabel = dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const subject = `Save the Date: ${dateLabel}`;

  const termsUrl = `${SITE_URL}/legal/operator-terms`;
  const opsHomeUrl = `${SITE_URL}/operators`;

  const vehicleType = ttype?.name || "vessel";
  const vehicleName = vehicle?.name || "your vessel";
  const journeyName = route?.route_name || "your scheduled route";
  const lockLabel = tMinus72.toLocaleString("en-GB");

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#111; line-height:1.5;">
    <p>Hello from Pace Shuttles!</p>

    <p>Your <strong>${esc(vehicleType)}</strong>, <strong>${esc(vehicleName)}</strong> has been assigned provisional passengers for the journey <strong>${esc(journeyName)}</strong> on <strong>${esc(dateLabel)}</strong> at <strong>${esc(timeLabel)}</strong>.</p>

    <p>You may remove this vehicle from the journey until <strong>${esc(
      lockLabel
    )}</strong> (T-72) after which point the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our <a href="${escAttr(
      termsUrl
    )}" target="_blank" rel="noopener">Terms and Conditions</a>.</p>

    <p>As always, you can check the progress of this prospect and your other engagements on the <a href="${escAttr(
      opsHomeUrl
    )}" target="_blank" rel="noopener">Pace Shuttles Operator's Home Page</a>.</p>

    <p>Please let us know if you have any questions at this stage.</p>

    <p>Thanks,<br/>The Pace Shuttles Team</p>
  </div>`.trim();

  const text = [
    `Hello from Pace Shuttles!`,
    ``,
    `Your ${vehicleType}, ${vehicleName} has been assigned provisional passengers for the journey ${journeyName} on ${dateLabel} at ${timeLabel}.`,
    ``,
    `You may remove this vehicle from the journey until ${lockLabel} (T-72) after which point the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our Terms and Conditions: ${termsUrl}`,
    ``,
    `Check progress on the Operator's Home Page: ${opsHomeUrl}`,
    ``,
    `Thanks`,
    `The Pace Shuttles Team`,
  ].join("\n");

  // Send email
  await sendViaResend({ to: operatorEmail, subject, html, text });

  // Record as sent (de-dupe)
  await admin.from("operator_journey_notices").insert({
    journey_id: journeyId,
    kind: "save_the_date",
    sent_at: new Date().toISOString(),
    vehicle_id: jny.vehicle_id ?? null,
    operator_id: jny.operator_id ?? null,
  });
}
