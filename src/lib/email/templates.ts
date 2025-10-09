// src/lib/email/templates.ts

export type BookingEmailInput = {
  leadFirst: string;
  orderRef?: string | null;
  vehicleType?: string | null;
  routeName?: string | null;
  journeyDate?: string | null; // YYYY-MM-DD
  journeyTime?: string | null; // "HH:mm"
  paymentAmountLabel: string;  // e.g. "£123.00"
  receiptUrl?: string | null;

  isWet?: boolean | null;
  wetAdviceFromDestination?: string | null; // use destination.arrival_notes or a fixed blurb

  pickupName?: string | null;
  pickupMapsUrl?: string | null;

  destinationName?: string | null;
  destinationUrl?: string | null;
  destinationEmail?: string | null;
  destinationPhone?: string | null;

  logoUrl?: string | null; // optional
};

export function renderBookingEmailHTML(d: BookingEmailInput) {
  const wetBlock = d.isWet
    ? `<p><strong>Important:</strong> This journey doesn’t have a fixed mooring at the destination and you may get wet when exiting the boat. Please bring a towel and appropriate clothing.</p>${
        d.wetAdviceFromDestination ? `<p>${d.wetAdviceFromDestination}</p>` : ""
      }`
    : "";

  const maps = d.pickupName && d.pickupMapsUrl
    ? `<a href="${d.pickupMapsUrl}">Google map directions to ${d.pickupName}</a>`
    : "";

  const receipt = d.receiptUrl
    ? `<a href="${d.receiptUrl}">Download your receipt</a>`
    : "Your receipt will be available shortly.";

  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;font-size:16px;color:#111">
    <p>Dear ${esc(d.leadFirst)},</p>

    <p><strong>Order Ref:</strong> ${esc(d.orderRef || "Pending")}</p>

    <p>
      This is confirmation of your booking of a return ${esc(d.vehicleType || "shuttle")} trip
      between ${esc(d.routeName || "your selected route")} on ${esc(d.journeyDate || "—")} at ${esc(d.journeyTime || "—")}.
    </p>

    <p>We have received your payment of ${esc(d.paymentAmountLabel)}. ${receipt}</p>

    ${wetBlock}

    <p>
      Your journey will leave from <strong>${esc(d.pickupName || "the pick-up point")}</strong>.
      Please arrive at least 10 minutes before departure time. ${maps}
    </p>

    <p>
      Just to remind you, Pace Shuttles have not made any reservations or arrangements for you and your party at
      <strong>${esc(d.destinationName || "the destination")}</strong>.
      If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.
    </p>

    <p>You can contact ${esc(d.destinationName || "the destination")} in the following ways:<br/>
      ${linkMaybe(d.destinationUrl)}<br/>
      ${esc(d.destinationEmail || "")}<br/>
      ${esc(d.destinationPhone || "")}
    </p>

    <p>
      We shall contact you the day before departure to confirm arrangements. In the event that the trip has to be
      cancelled due to adverse weather, or other factors beyond our control, we shall confirm this with you and fully refund your fare.
    </p>

    <p>Once again, thanks for booking with Pace Shuttles, we wish you an enjoyable trip.</p>

    ${d.logoUrl ? `<p><img src="${d.logoUrl}" alt="Pace Shuttles" style="max-width:220px"/></p>` : ""}

    <p>The Pace Shuttles Team</p>
  </div>
  `;
}

export function renderBookingEmailText(d: BookingEmailInput) {
  const wet = d.isWet
    ? `\nImportant: This journey doesn’t have a fixed mooring at the destination and you may get wet when exiting the boat. Please bring a towel and appropriate clothing.${
        d.wetAdviceFromDestination ? `\n${d.wetAdviceFromDestination}` : ""
      }\n`
    : "";
  const receipt = d.receiptUrl ? `Download your receipt: ${d.receiptUrl}` : "Receipt available shortly.";
  return [
    `Dear ${d.leadFirst}`,
    ``,
    `Order Ref: ${d.orderRef || "Pending"}`,
    ``,
    `This is confirmation of your booking of a return ${d.vehicleType || "shuttle"} trip between ${d.routeName || "your selected route"} on ${d.journeyDate || "—"} at ${d.journeyTime || "—"}.`,
    ``,
    `We have received your payment of ${d.paymentAmountLabel}. ${receipt}`,
    ``,
    wet,
    `Your journey will leave from ${d.pickupName || "the pick-up point"}. Please arrive at least 10 minutes before departure time.${
      d.pickupName ? ` Google Maps: ${d.pickupMapsUrl || ""}` : ""
    }`,
    ``,
    `Pace Shuttles has not made reservations at ${d.destinationName || "the destination"}. Please ensure you have a reservation if dining.`,
    ``,
    `Destination contact:\n${d.destinationUrl || ""}\n${d.destinationEmail || ""}\n${d.destinationPhone || ""}`,
    ``,
    `We will contact you the day before departure. If we cancel due to weather, you’ll receive a full refund.`,
    ``,
    `Thanks for booking with Pace Shuttles.`,
    `The Pace Shuttles Team`,
  ].join("\n");
}

function esc(s: string) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}
function linkMaybe(url?: string | null) {
  if (!url) return "";
  const safe = esc(url);
  return `<a href="${safe}">${safe}</a>`;
}
