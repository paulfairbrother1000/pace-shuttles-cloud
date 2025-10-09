// src/lib/email.ts
// Node-only; called from server routes (e.g. /api/checkout)
export const runtime = "nodejs";

import { createClient } from "@supabase/supabase-js";

/** ENV (required) */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Resend (REST API — no SDK needed)
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESEND_FROM =
  process.env.RESEND_FROM || "Pace Shuttles <bookings@paceshuttles.com>";

/** Supabase admin client (server) */
function sbAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/** Helpers */
function isWetTrip(wet_or_dry?: string | null) {
  return (wet_or_dry || "").toLowerCase() === "wet";
}
function fmtMoney(n: number, ccy: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: ccy,
  }).format(n);
}
function escHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s: string) {
  return escHtml(s).replace(/'/g, "&#39;");
}
function linkInherit(url: string, label: string, bold = false) {
  const safeUrl = escAttr(url);
  const safeLabel = escHtml(label);
  const weight = bold ? "font-weight:700" : "";
  // Keep link clickable but not blue/underlined
  return `<a href="${safeUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;${weight}">${safeLabel}</a>`;
}
function formatLocalDate(
  iso: string,
  tz?: string | null,
  locale?: string
): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale || "en-GB", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
function formatLocalTime(
  iso: string,
  tz?: string | null,
  locale?: string
): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(locale || "en-GB", {
      timeZone: tz || "UTC",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** -------------------- Customer email -------------------- **/

/** Compose the email (HTML + text) from database entities */
async function buildEmailForOrder(orderId: string) {
  const admin = sbAdmin();

  // Order (source of truth for recipient + amounts)
  const { data: order, error: oErr } = await admin
    .from("orders")
    .select(
      `
      id, status, currency, total_amount_c, total_cents,
      route_id, journey_date, qty,
      lead_first_name, lead_last_name, lead_email, lead_phone
    `
    )
    .eq("id", orderId)
    .maybeSingle();
  if (oErr || !order) throw oErr || new Error("Order not found");
  if (!order.lead_email) throw new Error("Order has no lead email");

  // Route + endpoints (+country)
  const { data: route, error: rErr } = await admin
    .from("routes")
    .select(
      `id, route_name, pickup_id, destination_id, transport_type, country_id`
    )
    .eq("id", order.route_id)
    .maybeSingle();
  if (rErr || !route) throw rErr || new Error("Route not found");

  const [{ data: pickup }, { data: dest }] = await Promise.all([
    admin
      .from("pickup_points")
      .select(`id, name`)
      .eq("id", route.pickup_id)
      .maybeSingle(),
    admin
      .from("destinations")
      .select(`id, name, url, email, phone, wet_or_dry, arrival_notes`)
      .eq("id", route.destination_id)
      .maybeSingle(),
  ]);

  const { data: country } = await admin
    .from("countries")
    .select("name, timezone")
    .eq("id", route.country_id)
    .maybeSingle();

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

  const tz = country?.timezone || "UTC";
  const locale =
    (typeof Intl !== "undefined" &&
      (Intl.DateTimeFormat().resolvedOptions().locale || "en-GB")) ||
    "en-GB";

  // Labels
  const journeyDateLabel = departure_ts
    ? formatLocalDate(departure_ts, tz, locale)
    : order.journey_date || "—";
  const journeyTimeLabel = departure_ts
    ? formatLocalTime(departure_ts, tz, locale)
    : "—";
  const ccy = order.currency || "GBP";
  const paymentAmount =
    typeof order.total_amount_c === "number"
      ? order.total_amount_c
      : (order.total_cents || 0) / 100;
  const paymentAmountLabel = fmtMoney(paymentAmount, ccy);

  const wetAdvice = isWetTrip(dest?.wet_or_dry)
    ? dest?.arrival_notes?.trim() ||
      "This journey doesn’t have a fixed mooring at the destination and you may get wet when exiting the boat. Please bring a towel and appropriate clothing."
    : "";

  // Links to your site (styled not-blue, not-underlined)
  const pickupLink = pickup?.id
    ? linkInherit(`/pickups/${pickup.id}`, pickup.name || "Pick-up", true)
    : escHtml(pickup?.name || "the departure point");
  const destLink = dest?.id
    ? linkInherit(
        `/destinations/${dest.id}`,
        dest.name || "Destination",
        true
      )
    : escHtml(dest?.name || "the destination");

  // Subject (unchanged)
  const subject = `Pace Shuttles – Booking Confirmation (${order.id})`;

  // Destination contact block (only if any detail present)
  const hasContact = !!(dest?.url || dest?.email || dest?.phone);
  const contactHtml = hasContact
    ? `
      <p style="margin-bottom:4px"><strong>Destination contact</strong></p>
      <p style="margin-top:0">
        ${dest?.url ? `Website: ${linkInherit(String(dest.url), String(dest.url))}<br/>` : ""}
        ${dest?.phone ? `Phone: ${escHtml(String(dest.phone))}<br/>` : ""}
        ${dest?.email ? `Email: ${escHtml(String(dest.email))}<br/>` : ""}
      </p>
    `
    : "";

  // Body (HTML)
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;font-size:16px">
    <p>Dear ${escHtml(order.lead_first_name || "")}</p>

    <p>
      This is confirmation of your booking of a return ${escHtml(
        route.transport_type || "shuttle"
      )} trip in ${escHtml(country?.name || "")} between ${pickupLink} → ${destLink}
      on ${escHtml(journeyDateLabel)} at ${escHtml(journeyTimeLabel)}.
    </p>

    <p>
      We have received your payment of <strong>${escHtml(
        paymentAmountLabel
      )}</strong>. You can find your booking details and confirmation on your account page on
      <a href="https://www.paceshuttles.com" target="_blank" rel="noopener">www.paceshuttles.com</a>.
    </p>

    ${
      wetAdvice
        ? `<p style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;margin:12px 0">${escHtml(
            wetAdvice
          )}</p>`
        : ""
    }

    <p>
      Your journey will leave from ${pickupLink}. Please arrive at least 10 minutes before departure time.
    </p>

    <p>
      Just to remind you, Pace Shuttles has not made any reservations or arrangements for you and your party at ${destLink}.
      If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.
    </p>

    ${contactHtml}

    <p>
      We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fare.
    </p>

    <p>Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.</p>

    <p>— The Pace Shuttles Team</p>
  </div>`.trim();

  // Plain text version
  const lines: string[] = [];
  lines.push(`Dear ${order.lead_first_name || ""}`);
  lines.push("");
  lines.push(
    `This is confirmation of your booking of a return ${route.transport_type ||
      "shuttle"} trip in ${country?.name || ""} between ${pickup?.name ||
      "Pick-up"} → ${dest?.name || "Destination"} on ${journeyDateLabel} at ${journeyTimeLabel}.`
  );
  lines.push("");
  lines.push(
    `We have received your payment of ${paymentAmountLabel}. You can find your booking details and confirmation on your account page on www.paceshuttles.com.`
  );
  lines.push("");
  if (wetAdvice) {
    lines.push(wetAdvice);
    lines.push("");
  }
  lines.push(
    `Your journey will leave from ${pickup?.name ||
      "the departure point"}. Please arrive at least 10 minutes before departure time.`
  );
  lines.push("");
  lines.push(
    `Just to remind you, Pace Shuttles has not made any reservations or arrangements for you and your party at ${dest?.name ||
      "the destination"}. If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.`
  );
  if (hasContact) {
    lines.push("");
    lines.push("Destination contact");
    if (dest?.url) lines.push(`Website: ${dest.url}`);
    if (dest?.phone) lines.push(`Phone: ${dest.phone}`);
    if (dest?.email) lines.push(`Email: ${dest.email}`);
  }
  lines.push("");
  lines.push(
    "We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fare."
  );
  lines.push("");
  lines.push("Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.");
  lines.push("");
  lines.push("— The Pace Shuttles Team");

  const text = lines.join("\n");

  return {
    to: order.lead_email as string,
    subject,
    html,
    text,
  };
}

/** Send email via Resend REST API (no SDK) */
async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
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

/** Public API used by /api/checkout (or future payment webhooks) */
export async function sendBookingPaidEmail(orderId: string): Promise<void> {
  const built = await buildEmailForOrder(orderId);
  await sendViaResend(built);
}

/** -------------------- Operator “Save the Date” email -------------------- **/

export async function sendOperatorSaveDateEmail(args: {
  to: string;
  vehicleName: string;
  vehicleType?: string | null;
  routeName: string;
  journeyDateISO: string; // full ISO datetime
  journeyTZ?: string | null;
  operatorHomeUrl?: string;
  termsUrl?: string;
  tMinusLockISO?: string | null; // departure - 72h
}) {
  const dateLabel = formatLocalDate(
    args.journeyDateISO,
    args.journeyTZ,
    "en-GB"
  );
  const timeLabel = formatLocalTime(
    args.journeyDateISO,
    args.journeyTZ,
    "en-GB"
  );
  const lockLabel = args.tMinusLockISO
    ? `${formatLocalDate(args.tMinusLockISO, args.journeyTZ, "en-GB")} ${formatLocalTime(
        args.tMinusLockISO,
        args.journeyTZ,
        "en-GB"
      )}`
    : null;
  const subj = `Save the Date: ${dateLabel}`;

  const pHome =
    args.operatorHomeUrl ||
    "https://www.paceshuttles.com/operators"; // adjust if different
  const pTerms =
    args.termsUrl || "https://www.paceshuttles.com/operators/terms";

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;font-size:16px">
    <p>Hello from Pace Shuttles!</p>
    <p>Your ${escHtml(args.vehicleType || "boat")}, <strong>${escHtml(
      args.vehicleName
    )}</strong> has been assigned provisional passengers for the journey <strong>${escHtml(
    args.routeName
  )}</strong> on <strong>${escHtml(dateLabel)}</strong> at <strong>${escHtml(
    timeLabel
  )}</strong>.</p>

    <p>You may remove this vehicle from the journey until ${
      lockLabel ? `<strong>${escHtml(lockLabel)}</strong>` : "T-72"
    } after which point the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our <a href="${escAttr(
    pTerms
  )}" target="_blank" rel="noopener">Terms and Conditions</a>.</p>

    <p>As always you can check the progress of this prospect, and your other engagements on the <a href="${escAttr(
      pHome
    )}" target="_blank" rel="noopener">Pace Shuttles Operator's Home Page</a>.</p>

    <p>Please let us know if you have any questions at this stage.</p>

    <p>Thanks<br/>The Pace Shuttles Team</p>
  </div>
  `.trim();

  const text = [
    "Hello from Pace Shuttles!",
    "",
    `Your ${args.vehicleType || "boat"}, ${args.vehicleName} has been assigned provisional passengers for the journey ${args.routeName} on ${dateLabel} at ${timeLabel}.`,
    "",
    `You may remove this vehicle from the journey until ${lockLabel ||
      "T-72"} after which point the journey assignment is locked. Any cancellations beyond this point may be subject to penalty as described in our Terms and Conditions: ${pTerms}`,
    "",
    `Check the prospect on your Operator's Home Page: ${pHome}`,
    "",
    "Please let us know if you have any questions at this stage.",
    "",
    "Thanks",
    "The Pace Shuttles Team",
  ].join("\n");

  await sendViaResend({ to: args.to, subject: subj, html, text });
}
