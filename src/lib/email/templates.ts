// src/lib/email/templates.ts

export type BookingEmailData = {
  orderRef: string;
  leadFirst: string;
  vehicleType: string;
  routeName: string;
  countryName: string;

  journeyDateISO: string;
  dateLabel: string; // e.g. 10/10/2025 (en-GB)
  timeLabel: string; // e.g. 12:00

  paymentAmountLabel: string;

  pickupId: string;
  pickupName: string;
  pickupPageUrl: string;
  pickupMapsUrl: string;

  destinationId: string;
  destinationName: string;
  destinationPageUrl: string;
  destinationUrl: string;
  destinationEmail: string;
  destinationPhone: string;

  isWet: boolean;
  wetAdviceFromDestination: string;

  logoUrl?: string;
};

const esc = (s: string) =>
  (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function linkIf(label: string, url?: string) {
  const safeLabel = esc(label);
  if (!url) return safeLabel;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

export function renderBookingEmailHTML(d: BookingEmailData): string {
  const contactLines: string[] = [];
  if (d.destinationUrl) {
    contactLines.push(
      `<div><strong>Website:</strong> <a href="${d.destinationUrl}" target="_blank" rel="noopener noreferrer">${esc(
        d.destinationUrl
      )}</a></div>`
    );
  }
  if (d.destinationPhone) {
    contactLines.push(`<div><strong>Phone:</strong> ${esc(d.destinationPhone)}</div>`);
  }
  if (d.destinationEmail) {
    contactLines.push(
      `<div><strong>Email:</strong> <a href="mailto:${d.destinationEmail}">${esc(d.destinationEmail)}</a></div>`
    );
  }

  const wetBlock =
    d.isWet && d.wetAdviceFromDestination
      ? `<p style="margin:12px 0; padding:10px; background:#fff7ed; border:1px solid #fdba74; border-radius:8px;">
           ${esc(d.wetAdviceFromDestination)}
         </p>`
      : "";

  return `<!doctype html>
<html>
  <body style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#111827; line-height:1.45;">
    <div style="max-width:640px; margin:0 auto; padding:20px;">
      ${d.logoUrl ? `<div style="margin-bottom:12px;"><img src="${d.logoUrl}" alt="Pace Shuttles" style="height:36px;" /></div>` : ""}

      <p>Dear ${esc(d.leadFirst)},</p>

      <p>
        This is confirmation of your booking of a return ${esc(d.vehicleType)} trip in
        ${esc(d.countryName || "—")} between
        ${linkIf(d.pickupName, d.pickupPageUrl)} &rarr; ${linkIf(d.destinationName, d.destinationPageUrl)}
        on ${esc(d.dateLabel)} at ${esc(d.timeLabel)}.
      </p>

      <p>
        We have received your payment of ${esc(d.paymentAmountLabel)}. You can find your booking details and
        confirmation on your account page on <a href="https://www.paceshuttles.com" target="_blank" rel="noopener noreferrer">www.paceshuttles.com</a>.
      </p>

      ${wetBlock}

      <p>
        Your journey will leave from ${linkIf(d.pickupName, d.pickupPageUrl)}.
        Please arrive at least 10 minutes before departure time.
        Google Maps directions to ${esc(d.pickupName)} are available
        <a href="${d.pickupMapsUrl}" target="_blank" rel="noopener noreferrer">here</a>.
      </p>

      <p>
        Just to remind you, Pace Shuttles <strong>has</strong> not made any reservations or arrangements
        for you and your party at ${linkIf(d.destinationName, d.destinationPageUrl)}. If you are travelling for lunch
        or dinner, please ensure you have an appropriate reservation to avoid disappointment.
      </p>

      <p>You can contact ${linkIf(d.destinationName, d.destinationPageUrl)} in the following ways:</p>
      <div style="margin:8px 0 16px 0;">
        ${contactLines.join("") || "<div>—</div>"}
      </div>

      <p>
        We shall contact you the day before departure to confirm arrangements.
        In the event that the trip has to be cancelled due to adverse weather, or other factors beyond our control,
        we shall confirm this with you and fully refund your fare.
      </p>

      <p>Once again, thanks for booking with Pace Shuttles — we wish you an enjoyable trip.</p>

      <p style="margin-top:20px">The Pace Shuttles Team</p>
    </div>
  </body>
</html>`;
}

export function renderBookingEmailText(d: BookingEmailData): string {
  const lines: string[] = [];

  lines.push(`Dear ${d.leadFirst},`);
  lines.push("");
  lines.push(
    `This is confirmation of your booking of a return ${d.vehicleType} trip in ${d.countryName || "—"} between ` +
      `${d.pickupName} -> ${d.destinationName} on ${d.dateLabel} at ${d.timeLabel}.`
  );
  lines.push("");
  lines.push(
    `We have received your payment of ${d.paymentAmountLabel}. You can find your booking details and confirmation on your account page on www.paceshuttles.com.`
  );
  lines.push("");

  if (d.isWet && d.wetAdviceFromDestination) {
    lines.push(d.wetAdviceFromDestination);
    lines.push("");
  }

  lines.push(`Your journey will leave from ${d.pickupName} (${d.pickupPageUrl || "detail page"}).`);
  lines.push(
    `Please arrive at least 10 minutes before departure. Google Maps directions: ${d.pickupMapsUrl}`
  );
  lines.push("");
  lines.push(
    `Just to remind you, Pace Shuttles has not made any reservations or arrangements for you and your party at ${d.destinationName} (${d.destinationPageUrl || "detail page"}).`
  );
  lines.push(
    `If you are travelling for lunch or dinner, please ensure you have an appropriate reservation to avoid disappointment.`
  );
  lines.push("");
  lines.push(`You can contact ${d.destinationName} in the following ways:`);
  if (d.destinationUrl) lines.push(`Website: ${d.destinationUrl}`);
  if (d.destinationPhone) lines.push(`Phone: ${d.destinationPhone}`);
  if (d.destinationEmail) lines.push(`Email: ${d.destinationEmail}`);
  lines.push("");
  lines.push(
    `We will contact you the day before departure to confirm arrangements. If the trip has to be cancelled due to adverse weather or other factors beyond our control, we will confirm this with you and fully refund your fare.`
  );
  lines.push("");
  lines.push(`The Pace Shuttles Team`);

  return lines.join("\n");
}
