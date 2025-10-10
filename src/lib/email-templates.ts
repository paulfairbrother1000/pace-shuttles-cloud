// src/lib/email-templates.ts
type Captain = { first: string; last: string; roleLabel: string; pronoun: "he"|"she"|"they"; photoUrl?: string|null };
type Vehicle = { typeLabel: string; name: string; photoUrl?: string|null };
type RouteBits = { journeyName: string; dateStr: string; timeStr: string; pickupName: string; pickupNotes?: string|null };
type ManifestGroup = {
  size: number;
  leadName: string;
  leadEmail?: string|null;
  leadPhone?: string|null;
  guests?: string[]; // guest names if available
};
type OperatorEmailData = {
  route: RouteBits;
  vehicle: Vehicle;
  paxTotal: number;
  revenueNet?: string|null; // "£1,234.00" if you compute it; else null/"—"
  captain?: Captain|null;
  crew?: { name: string }[]; // optional
  groups: ManifestGroup[];
  termsUrl: string; // operator Ts&Cs link
};
type ClientEmailData = {
  leadFirst: string;
  route: RouteBits & { arriveByStr: string };
  vehicle: Vehicle;
  captain?: Captain|null;
  guestFirstNames: string[];          // ["Alex","Sam",...]
  roleNoun: string;                    // "Captain" | "Driver" | "Pilot"
  clientTermsUrl: string;              // link to client Ts&Cs
};

const baseCss = `
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:640px;margin:0 auto;padding:24px}
  .muted{color:#6b7280}
  .pill{display:inline-block;padding:4px 8px;border-radius:9999px;background:#f3f4f6;font-size:12px}
  h1{font-size:20px;margin:0 0 8px} h2{font-size:16px;margin:16px 0 8px}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #e5e7eb;padding:8px;font-size:14px;text-align:left;vertical-align:top}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .small{font-size:12px}
`;

export function operatorT24Html(d: OperatorEmailData) {
  const crewHtml = (d.crew && d.crew.length)
    ? `<p><strong>Crew:</strong><br/>${d.crew.map(c => c.name).join("<br/>")}</p>` : "";

  const captainLine = d.captain
    ? `${d.captain.first} ${d.captain.last}`
    : "Unassigned";

  const groupsHtml = d.groups.map((g, i) => `
    <tr>
      <td>Group ${i+1}<br/><span class="muted small">${g.size} people</span></td>
      <td>
        <div><strong>Lead:</strong> ${g.leadName}</div>
        ${g.leadEmail ? `<div>Email: ${g.leadEmail}</div>` : ""}
        ${g.leadPhone ? `<div>Phone: ${g.leadPhone}</div>` : ""}
        ${g.guests && g.guests.length ? g.guests.map((n,idx)=>`<div>Passenger ${idx+2}: ${n}</div>`).join("") : ""}
      </td>
    </tr>
  `).join("");

  return `<!doctype html><html><head><meta charset="utf-8"/><style>${baseCss}</style></head><body>
  <div class="wrap">
    <p class="pill">Operator T-24 Manifest</p>
    <h1>Hello from Pace Shuttles</h1>
    <p>The details for your <strong>${d.route.journeyName}</strong> trip tomorrow can now be confirmed.</p>

    <h2>Booking Summary</h2>
    <div class="grid">
      <div><strong>${d.vehicle.typeLabel}:</strong><br/>${d.vehicle.name}</div>
      <div><strong>Date:</strong><br/>${d.route.dateStr}</div>
      <div><strong>No. of Passengers:</strong><br/>${d.paxTotal}</div>
      <div><strong>Pickup Location:</strong><br/>${d.route.pickupName}</div>
      <div><strong>Pickup Time:</strong><br/>${d.route.timeStr}</div>
      <div><strong>Boat Revenue:</strong><br/>${d.revenueNet || "—"}</div>
      <div><strong>Captain:</strong><br/>${captainLine}</div>
      <div>${crewHtml || ""}</div>
    </div>

    <h2>Manifest</h2>
    <table>
      <thead><tr><th>Group</th><th>Details</th></tr></thead>
      <tbody>${groupsHtml}</tbody>
    </table>

    <p class="small muted">Removing this ${d.vehicle.typeLabel} from the journey at this late stage may result in fees being paid.</p>
    <p class="small">Operator Terms &amp; Conditions: <a href="${d.termsUrl}">${d.termsUrl}</a></p>

    <p>Thanks<br/>The Pace Shuttles Team</p>
  </div>
  </body></html>`;
}

export function clientT24Html(d: ClientEmailData) {
  const pronoun = d.captain?.pronoun || "they";
  const subjNoun = pronoun === "he" ? "him" : pronoun === "she" ? "her" : "them";
  const meetPlace = d.vehicle.typeLabel.toLowerCase().includes("heli")
    ? "helipad"
    : d.vehicle.typeLabel.toLowerCase().includes("bus") || d.vehicle.typeLabel.toLowerCase().includes("limo")
    ? "carpark"
    : "dock";

  const guestNames = d.guestFirstNames?.length ? d.guestFirstNames.join(", ") : "your guests";

  return `<!doctype html><html><head><meta charset="utf-8"/><style>${baseCss}</style></head><body>
  <div class="wrap">
    <p class="pill">Your trip is tomorrow</p>
    <h1>Hi ${d.leadFirst},</h1>

    <p>Your <strong>${d.route.journeyName}</strong> trip is tomorrow at <strong>${d.route.timeStr}</strong>.</p>
    <p>We look forward to welcoming you and ${guestNames} at <strong>${d.route.pickupName}</strong>.</p>

    <div class="grid">
      <div>
        <p><strong>${d.roleNoun}:</strong> ${d.captain ? `${d.captain.first} ${d.captain.last}` : "TBC"}</p>
        <p><strong>${d.vehicle.typeLabel}:</strong> ${d.vehicle.name}</p>
      </div>
      <div>
        ${d.captain?.photoUrl ? `<img src="${d.captain.photoUrl}" alt="Captain" style="width:100%;max-width:280px;border-radius:12px;border:1px solid #e5e7eb;"/>` : ""}
      </div>
    </div>

    <p>Please be at <strong>${d.route.pickupName}</strong> by <strong>${d.route.arriveByStr}</strong>.</p>
    ${d.route.pickupNotes ? `<p>${d.route.pickupNotes}</p>` : ""}
    <p class="small muted">Look out for ${subjNoun} at the ${meetPlace}.</p>

    <p class="small">Client Terms &amp; Conditions: <a href="${d.clientTermsUrl}">${d.clientTermsUrl}</a></p>
    <p>Have a great trip!<br/>The Pace Shuttles Team</p>
  </div>
  </body></html>`;
}
