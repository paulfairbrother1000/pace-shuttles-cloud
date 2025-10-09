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
function fmtLocalDate(d: Date, locale = "en-GB") {
  return d.toLocaleDateString(locale);
}
function fmtLocalTime(d: Date, locale = "en-GB") {
  return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
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
function esc(s: string) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}
function linkMaybe(url?: string | null) {
  if (!url) return "";
  const safe = esc(url);
  return `<a href="${safe}">${safe}</a>`;
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

/* =========================================================================
 *  CUSTOMER – BOOKING CONFIRMATION (PAID)
 * =========================================================================*/

/** Compose the email (HTML + text) for the customer from database entities */
async function buildCustomerEmailForOrder(orderId: string) {
  const admin = sbAdmin();

  // Order (recipient + amounts)
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

  // Route + endpoints (+ country via route->countries if available)
  const { data: route, error: rErr } = await admin
    .from("routes")
    .select(`
      id, route_name, pickup_id, destination_id, transport_type,
      countries:country_id ( name )
    `)
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
  const journeyDateISO = order.journey_date || (dt ? dt.toISOString().slice(0, 10) : "—");
  const journeyDate = dt ? fmtLocalDate(dt, "en-GB") : journeyDateISO;
  const journeyTime = dt ? fmtLocalTime(dt, "en-GB") : "—";
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
    // (We no longer add "Booking confirmation — <order id>" in body)
    `This is confirmation of your booking of a return ${route.transport_type || "shuttle"} trip in ${route.countries?.name || ""} between ${route.route_name || ""} on ${journeyDate} at ${journeyTime}.`,
    ``,
    `We have received your payment of ${paymentAmountLabel}. You can find your booking details and confirmation on your account page on www.paceshuttles.com.`,
    ``,
    wetAdvice ? wetAdvice : "",
    wetAdvice ? "" : "",
    `Your journey will leave from ${pickup?.name || "the departure point"} (Google Maps: ${pickupMaps}). Please arrive at least 10 minutes before departure time.`,
    ``,
    `Just to remind you, Pace Shuttles has not made any reservations or arrangements for you and your party at ${dest?.name || "the destination"}. If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.`,
    ``,
    `Website: ${dest?.url || ""}`,
    `Phone: ${dest?.phone || ""}`,
    `Email: ${dest?.email || ""}`,
    ``,
    `We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fare.`,
    ``,
    `Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.`,
    ``,
    `The Pace Shuttles Team`,
  ]
    .filter(Boolean)
    .join("\n");

  // Links to pickup/destination pages
  const pickupHref = pickup?.id ? `https://www.paceshuttles.com/pickups/${encodeURIComponent(pickup.id)}` : null;
  const destHref = dest?.id ? `https://www.paceshuttles.com/destinations/${encodeURIComponent(dest.id)}` : null;

  // Body (HTML)
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
    <p>Dear ${escapeHtml(order.lead_first_name || "")}</p>

    <p>
      This is confirmation of your booking of a return
      <strong>${escapeHtml(route.transport_type || "shuttle")}</strong> trip in
      <strong>${escapeHtml(route.countries?.name || "")}</strong> between
      ${
        pickupHref
          ? `<a href="${escapeAttr(pickupHref)}">${escapeHtml(pickup?.name || "")}</a>`
          : `<strong>${escapeHtml(pickup?.name || "")}</strong>`
      }
       &rarr; 
      ${
        destHref
          ? `<a href="${escapeAttr(destHref)}">${escapeHtml(dest?.name || "")}</a>`
          : `<strong>${escapeHtml(dest?.name || "")}</strong>`
      }
      on <strong>${escapeHtml(journeyDate)}</strong> at <strong>${escapeHtml(journeyTime)}</strong>.
    </p>

    <p>
      We have received your payment of <strong>${escapeHtml(paymentAmountLabel)}</strong>.
      You can find your booking details and confirmation on your account page on
      <a href="https://www.paceshuttles.com" target="_blank" rel="noopener">www.paceshuttles.com</a>.
    </p>

    ${wetAdvice
      ? `<p style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px"><strong>Wet trip advice:</strong> ${escapeHtml(
          wetAdvice
        )}</p>`
      : ""}

    <p>
      Your journey will leave from ${
        pickupHref
          ? `<a href="${escapeAttr(pickupHref)}">${escapeHtml(pickup?.name || "the departure point")}</a>`
          : `<strong>${escapeHtml(pickup?.name || "the departure point")}</strong>`
      }.
      Please arrive at least 10 minutes before departure time.
      <a href="${pickupMaps}" target="_blank" rel="noopener">Google map directions</a>.
    </p>

    <p>
      Just to remind you, Pace Shuttles has not made any reservations or arrangements for you and your party at
      ${
        destHref
          ? `<a href="${escapeAttr(destHref)}">${escapeHtml(dest?.name || "the destination")}</a>`
          : `<strong>${escapeHtml(dest?.name || "the destination")}</strong>`
      }.
      If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.
    </p>

    <p><strong>Destination contact</strong><br/>
      ${dest?.url ? `Website: <a href="${escapeAttr(dest.url)}" target="_blank" rel="noopener">${escapeHtml(dest.url)}</a><br/>` : ""}
      ${dest?.phone ? `Phone: ${escapeHtml(String(dest.phone))}<br/>` : ""}
      ${dest?.email ? `Email: ${escapeHtml(String(dest.email))}<br/>` : ""}
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

/**
 * Public API used by /api/checkout (or future payment webhooks):
 * Sends the "booking paid" email to the lead passenger.
 */
export async function sendBookingPaidEmail(orderId: string): Promise<void> {
  const built = await buildCustomerEmailForOrder(orderId);
  await sendViaResend(built);
}

/* =========================================================================
 *  OPERATOR – SAVE THE DATE (FIRST BOOKING ON A JOURNEY, >72H)
 * =========================================================================*/

export async function sendOperatorSaveTheDate(journeyId: string): Promise<void> {
  const admin = sbAdmin();

  // Count bookings for this journey. Send only on the FIRST one.
  const { data: cntRows, error: cntErr } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("journey_id", journeyId);

  if (cntErr) {
    console.warn("[email] save-the-date: count error", cntErr);
    return;
  }
  const total = (cntRows as any)?.length ?? (cntErr ? 0 : (cntRows as any));
  // Some drivers return no rows when head:true; use count from response if available:
  const countHeader = (cntErr as any)?.count || (cntRows as any)?.count;
  const count = typeof countHeader === "number" ? countHeader : total;

  if (count !== 1) {
    // Not the first booking → no email.
    return;
  }

  // Pull journey + route + vehicle (+ operator + transport type)
  const { data: jny, error: jErr } = await admin
    .from("journeys")
    .select(`
      id, route_id, vehicle_id, departure_ts,
      routes:route_id (
        id, route_name, pickup_id, destination_id, transport_type
      ),
      vehicles:vehicle_id (
        id, name, operator_id, type_id
      )
    `)
    .eq("id", journeyId)
    .maybeSingle();

  if (jErr || !jny) {
    console.warn("[email] save-the-date: journey lookup failed", jErr);
    return;
  }

  // T-72 guard
  if (!jny.departure_ts) return;
  const dep = new Date(jny.departure_ts);
  const msToGo = dep.getTime() - Date.now();
  const hoursToGo = msToGo / 36e5;
  if (!Number.isFinite(hoursToGo) || hoursToGo < 72) {
    // Inside lock window → don't send.
    return;
  }

  // Resolve boat type name
  let boatTypeName = "boat";
  if (jny.vehicles?.type_id) {
    const { data: t } = await admin
      .from("transport_types")
      .select("name")
      .eq("id", jny.vehicles.type_id)
      .maybeSingle();
    boatTypeName = t?.name || boatTypeName;
  } else if (jny.routes?.transport_type) {
    // sometimes route.transport_type holds a name or id
    boatTypeName = String(jny.routes.transport_type);
  }

  // Operator email: prefer operators.email; fallback to first operator_admin user
  let operatorEmail: string | null = null;
  let operatorName: string | null = null;

  if (jny.vehicles?.operator_id) {
    const { data: op } = await admin
      .from("operators")
      .select("id, name, email")
      .eq("id", jny.vehicles.operator_id)
      .maybeSingle();
    operatorName = op?.name || null;
    operatorEmail = (op as any)?.email || null;

    if (!operatorEmail) {
      const { data: adminUser } = await admin
        .from("users")
        .select("email")
        .eq("operator_id", jny.vehicles.operator_id)
        .eq("operator_admin", true)
        .not("email", "is", null)
        .limit(1)
        .maybeSingle();
      operatorEmail = adminUser?.email || null;
    }
  }

  if (!operatorEmail) {
    console.warn("[email] save-the-date: no operator email found");
    return;
  }

  const routeName = jny.routes?.route_name || "your route";
  const vehicleName = jny.vehicles?.name || "your vessel";
  const journeyDate = fmtLocalDate(dep, "en-GB");
  const journeyTime = fmtLocalTime(dep, "en-GB");

  const subject = `Save the Date: ${journeyDate}`;

  const opsHome = "https://www.paceshuttles.com/ops";
  const opsTerms = "https://www.paceshuttles.com/operators/terms";

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111">
    <p>Hello from Pace Shuttles${operatorName ? `, ${escapeHtml(operatorName)}` : ""}!</p>

    <p>Your <strong>${escapeHtml(boatTypeName)}</strong>, <strong>${escapeHtml(
    vehicleName
  )}</strong> has been assigned provisional passengers for the journey <strong>${escapeHtml(
    routeName
  )}</strong> on <strong>${escapeHtml(journeyDate)}</strong> at <strong>${escapeHtml(
    journeyTime
  )}</strong>.</p>

    <p>You may remove this vehicle from the journey until <strong>T-72</strong>, after which the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our <a href="${escapeAttr(
      opsTerms
    )}" target="_blank" rel="noopener">Terms and Conditions</a>.</p>

    <p>As always you can check the progress of this prospect, and your other engagements on the <a href="${escapeAttr(
      opsHome
    )}" target="_blank" rel="noopener">Pace Shuttles Operator's Home Page</a>.</p>

    <p>Please let us know if you have any questions at this stage.</p>

    <p>Thanks,<br/>The Pace Shuttles Team</p>
  </div>
  `.trim();

  const text = [
    `Hello from Pace Shuttles${operatorName ? `, ${operatorName}` : ""}!`,
    ``,
    `Your ${boatTypeName}, ${vehicleName} has been assigned provisional passengers for the journey ${routeName} on ${journeyDate} at ${journeyTime}.`,
    ``,
    `You may remove this vehicle from the journey until T-72, after which the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our Terms and Conditions: ${opsTerms}`,
    ``,
    `Check progress on the Operator's Home Page: ${opsHome}`,
    ``,
    `Thanks`,
    `The Pace Shuttles Team`,
  ].join("\n");

  await sendViaResend({ to: operatorEmail, subject, html, text });
}
