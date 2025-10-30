// src/components/AgentChat.tsx
"use client";

import * as React from "react";

/* ──────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */
type SourceLink = { title: string; section?: string | null; url?: string | null };

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceLink[];
  meta?: {
    clarify?: boolean;
    expect?: string | null;
    requireLogin?: boolean;
    mode?: "anon" | "signed";
    usedSnippets?: number;
    summary?: string;
    entities?: Partial<ParsedEntities>;
  };
};

type UUID = string;

type Country = {
  id?: UUID | null;
  name: string;
  description?: string | null;
  slug?: string | null;
};

type Destination = {
  name: string;
  country_name?: string | null;
  description?: string | null;
  address1?: string | null;
  address2?: string | null;
  town?: string | null;
  region?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  website_url?: string | null;
  image_url?: string | null;
  directions_url?: string | null;
  active?: boolean | null;
  type?: string | null;
  category?: string | null;
  tags?: string[] | null;
};

type VisibleRoute = {
  route_id: UUID;
  route_name: string;
  country_id?: UUID | null;
  country_name?: string | null;
  destination_id?: UUID | null;
  destination_name?: string | null;
  pickup_id?: UUID | null;
  pickup_name?: string | null;
  vehicle_type_id?: UUID | null;
  vehicle_type_name?: string | null;
  country_description?: string | null;
  destination_description?: string | null;
  pickup_description?: string | null;
};

type VehicleType = {
  id: UUID;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  capacity?: number | null;
  features?: string[] | null;
};

type QuoteRequest = {
  date?: string; // ISO yyyy-mm-dd
  country_id?: UUID | null;
  destination_id?: UUID | null;
  pickup_id?: UUID | null;
};
type QuoteItem = {
  route_id: UUID;
  route_name: string;
  destination_name?: string | null;
  pickup_name?: string | null;
  price_per_seat: number;
  currency: string;
  quoteToken: string;
};
type QuoteResponse = { items: QuoteItem[] };

/* ──────────────────────────────────────────────
   Config — align with HOME PAGE endpoints
   ────────────────────────────────────────────── */
const API = {
  // Try these in order; keep in sync with homepage.
  visibleRoutesCandidates: [
    "/api/public/routes?onlyVisible=1",
    "/api/public/routes?visible=1",
    "/api/public/routes-visible",
    "/api/public/visible-routes",
  ],
  countries: "/api/public/countries", // enrichment only (never to widen)
  destinations: "/api/public/destinations",
  pickups: "/api/public/pickups", // optional; enrich if present
  vehicleTypes: "/api/public/vehicle-types",
  quote: "/api/quote",
};

/* ──────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────── */
async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}
async function jsonArray<T>(res: Response): Promise<T[]> {
  const data = await safeJson<any>(res);
  if (Array.isArray(data)) return data as T[];
  if (data?.rows && Array.isArray(data.rows)) return data.rows as T[];
  if (data?.data && Array.isArray(data.data)) return data.data as T[];
  throw new Error("Unexpected API response shape (no array found).");
}
function uniqBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = key(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}
function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s\-&']/gu, " ").replace(/\s+/g, " ").trim();
}
function titleCase(s: string) {
  return s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1));
}

/* ──────────────────────────────────────────────
   Type inference for destinations
   ────────────────────────────────────────────── */
const TYPE_SYNONYMS: Record<string, string> = {
  restaurant: "restaurant",
  restaurants: "restaurant",
  cafe: "restaurant",
  cafés: "restaurant",
  caffes: "restaurant",
  bar: "bar",
  bars: "bar",
  "beach club": "beach club",
  "beach clubs": "beach club",
  beachclub: "beach club",
  beachclubs: "beach club",
  club: "beach club",
  lounge: "bar",
  cocktail: "bar",
  brunch: "restaurant",
  lunch: "restaurant",
  dinner: "restaurant",
};
function detectDestinationTypeFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = normalize(text);
  for (const key of Object.keys(TYPE_SYNONYMS)) {
    if (t.includes(key)) return TYPE_SYNONYMS[key];
  }
  return null;
}
function getDestinationType(d: Destination): string | null {
  const direct =
    d.type?.toLowerCase() ||
    d.category?.toLowerCase() ||
    (Array.isArray(d.tags) ? d.tags.map((x) => x.toLowerCase()).find((x) => TYPE_SYNONYMS[x]) || null : null);
  if (direct) return TYPE_SYNONYMS[direct] || direct;
  return detectDestinationTypeFromText(d.description) || detectDestinationTypeFromText(d.name) || null;
}

/* ──────────────────────────────────────────────
   Catalogue (STRICTLY derived from visible routes)
   ────────────────────────────────────────────── */
type Catalog = {
  routes: VisibleRoute[];
  countries: Country[];
  destinationsAll: Destination[];
  visibleDestinations: Destination[];
  vehicleTypes: VehicleType[];
  vehicleTypeById: Record<string, VehicleType>;
  countryToVehicleTypes: Record<string, string[]>; // country_name -> array of vehicle_type_id
};
const emptyCatalog: Catalog = {
  routes: [],
  countries: [],
  destinationsAll: [],
  visibleDestinations: [],
  vehicleTypes: [],
  vehicleTypeById: {},
  countryToVehicleTypes: {},
};

async function fetchVisibleRoutes(): Promise<VisibleRoute[]> {
  for (const url of API.visibleRoutesCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const rows = await jsonArray<VisibleRoute>(res);
      if (rows?.length) return rows;
    } catch {
      /* try next */
    }
  }
  return [];
}

async function fetchVehicleTypes(): Promise<VehicleType[]> {
  try {
    const res = await fetch(API.vehicleTypes, { cache: "no-store" });
    return await jsonArray<VehicleType>(res);
  } catch {
    return [];
  }
}

async function fetchVisibleCatalog(): Promise<Catalog> {
  // 1) STRICT: visible routes are the single source of truth
  const routes = await fetchVisibleRoutes();
  if (!routes.length) return { ...emptyCatalog };

  // 2) Derive countries ONLY from routes
  const countries: Country[] = uniqBy(
    routes
      .filter((r) => r.country_name)
      .map((r) => ({
        id: r.country_id ?? null,
        name: r.country_name || "Unknown",
        description: r.country_description ?? null,
      })),
    (c) => (c.id ?? c.name ?? "").toString().toLowerCase()
  );

  // 3) Load destinations and restrict to those present in routes
  let destinationsAll: Destination[] = [];
  try {
    const dRes = await fetch(API.destinations, { cache: "no-store" });
    destinationsAll = await jsonArray<Destination>(dRes);
  } catch {
    destinationsAll = [];
  }
  const visibleNames = new Set(
    routes.filter((r) => r.destination_name).map((r) => (r.destination_name || "").toLowerCase())
  );
  const visibleDestinations = destinationsAll.filter(
    (d) => d.name && visibleNames.has(d.name.toLowerCase())
  );

  // 4) Vehicle types and mapping to countries via routes
  const vehicleTypes = await fetchVehicleTypes();
  const vehicleTypeById: Record<string, VehicleType> = {};
  for (const vt of vehicleTypes) vehicleTypeById[vt.id] = vt;

  // Build country -> vehicle type ids seen in routes
  const countryToVehicleTypes: Record<string, string[]> = {};
  for (const r of routes) {
    const c = (r.country_name || "").trim();
    if (!c) continue;
    const vtId =
      (r.vehicle_type_id as string | undefined) ||
      (vehicleTypes.find((vt) => normalize(vt.name) === normalize(r.vehicle_type_name || ""))?.id ?? "");
    if (!vtId) continue;
    if (!countryToVehicleTypes[c]) countryToVehicleTypes[c] = [];
    if (!countryToVehicleTypes[c].includes(vtId)) countryToVehicleTypes[c].push(vtId);
  }

  return { routes, countries, destinationsAll, visibleDestinations, vehicleTypes, vehicleTypeById, countryToVehicleTypes };
}

/* ──────────────────────────────────────────────
   NLU
   ────────────────────────────────────────────── */
type Intent =
  | "company"
  | "ask_countries"
  | "ask_destinations"
  | "ask_destinations_by_type"
  | "dest_info"
  | "dest_address"
  | "dest_map"
  | "dest_phone"
  | "dest_website"
  | "dest_image"
  | "ask_pickups"
  | "transport_types"
  | "transport_in_country"
  | "journeys"
  | "availability"
  | "unknown";

type ParsedEntities = {
  intent?: Intent;
  countryName?: string;
  destinationName?: string;
  pickupName?: string;
  dateISO?: string;
  destType?: string | null;
  transportType?: string | null;
};

function parseDateToISO(input: string): string | undefined {
  const iso = input.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) return iso[0];
  const uk = input.match(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(\d{2}|\d{4})\b/);
  if (uk) {
    const dd = parseInt(uk[1], 10);
    const mm = parseInt(uk[2], 10);
    const yyyy = uk[3].length === 2 ? 2000 + parseInt(uk[3], 10) : parseInt(uk[3], 10);
    if (yyyy >= 2000 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function detectIntent(raw: string): Intent {
  const t = normalize(raw);

  if (/\b(about|what is|who are|pace shuttles|your company|how it (works|work))\b/.test(t)) return "company";

  if (/\b(what|which)\b.*\bcountries?\b/.test(t)) return "ask_countries";
  if (/\b(destinations?|stops?)\b/.test(t) && /\bin\b/.test(t)) return "ask_destinations";

  if (/\b(restaurant|restaurants|bar|bars|beach ?club|beach ?clubs|cafe|caf[eé]s|lunch|dinner|brunch)\b/.test(t)
      && /\b(what|which|show|list|where)\b/.test(t)) return "ask_destinations_by_type";

  if (/\b(tell me about|what is|info on|describe)\b/.test(t)) return "dest_info";
  if (/\b(address|where is|what is the address)\b/.test(t)) return "dest_address";
  if (/\b(map|google maps|directions)\b/.test(t)) return "dest_map";
  if (/\b(phone|telephone|contact number)\b/.test(t)) return "dest_phone";
  if (/\b(website|url|link)\b/.test(t)) return "dest_website";
  if (/\b(image|photo|picture|pic)\b/.test(t)) return "dest_image";

  if (/\b(pickups?|pickup points?)\b/.test(t)) return "ask_pickups";

  if (/\b(transport|vehicle|boat|boats|helicopter|catamaran|minibus|speedboat|types?)\b/.test(t) &&
      /\b(what|which|do you have|use|operate)\b/.test(t)) {
    if (/\bin\b/.test(t)) return "transport_in_country";
    return "transport_types";
  }

  if (/\b(show|find|list|any|anything|available|journeys?|routes?|book|schedule)\b/.test(t) &&
      /\b(on|today|tomorrow|this|next|week|month|date)\b/.test(t)) return "availability";

  if (/\b(show|find|list|journeys?|routes?)\b/.test(t)) return "journeys";

  return "unknown";
}

function extractSurfaceEntities(raw: string): Omit<ParsedEntities, "intent"> {
  const dateISO = parseDateToISO(raw);
  const inMatch = raw.match(/\b(?:in|to)\s+([A-Za-z][A-Za-z\s&\-']{1,80})/i);
  const surface = inMatch?.[1]?.trim()?.replace(/\s+on\s+.*$/i, "").trim();
  const quoted = raw.match(/["“”']([^"“”']{2,80})["“”']/);
  const quotedName = quoted?.[1]?.trim();

  let destType: string | null = null;
  for (const k of Object.keys(TYPE_SYNONYMS)) {
    if (normalize(raw).includes(k)) { destType = TYPE_SYNONYMS[k]; break; }
  }

  let transportType: string | null = null;
  const tnorm = normalize(raw);
  const transportKeywords = ["speedboat","catamaran","helicopter","minibus","bus","boat","boats"];
  for (const k of transportKeywords) if (tnorm.includes(k)) { transportType = k; break; }

  return {
    countryName: surface || undefined,
    destinationName: quotedName,
    dateISO,
    destType,
    transportType,
  };
}

function bestNameMatch<T extends { name: string }>(name: string, items: T[]): T | undefined {
  const n = normalize(name);
  return items.find((i) => normalize(i.name) === n)
      || items.find((i) => normalize(i.name).startsWith(n))
      || items.find((i) => normalize(i.name).includes(n));
}

type ConversationContext = {
  country?: Country;
  destination?: Destination;
  pickupName?: string;
  dateISO?: string;
  lastEntityKind?: "country" | "destination" | "pickup";
};

function resolveEntities(
  parsed: ParsedEntities,
  catalog: Catalog,
  ctx: ConversationContext
): {
  country?: Country; destination?: Destination; pickupName?: string;
  dateISO?: string; destType?: string | null; transportType?: string | null
} {
  let country: Country | undefined;
  let destination: Destination | undefined;
  let pickupName: string | undefined;
  const dateISO = parsed.dateISO ?? ctx.dateISO ?? undefined;

  const destNameCandidate = parsed.destinationName || parsed.countryName;
  if (destNameCandidate) {
    destination = bestNameMatch(destNameCandidate, catalog.visibleDestinations)
               ?? bestNameMatch(destNameCandidate, catalog.destinationsAll)
               ?? undefined;
  }
  if (parsed.countryName && !destination) {
    country = bestNameMatch(parsed.countryName, catalog.countries);
  }
  if (!country && ctx.country) country = ctx.country;
  if (!destination && ctx.destination) destination = ctx.destination;
  if (!country && destination?.country_name) {
    country = bestNameMatch(destination.country_name, catalog.countries);
  }
  if (parsed.pickupName) pickupName = parsed.pickupName;
  else if (ctx.pickupName) pickupName = ctx.pickupName;

  return {
    country, destination, pickupName,
    dateISO,
    destType: parsed.destType ?? null,
    transportType: parsed.transportType ?? null,
  };
}

/* ──────────────────────────────────────────────
   SSOT quotes
   ────────────────────────────────────────────── */
async function fetchQuotes(req: QuoteRequest): Promise<QuoteResponse> {
  const res = await fetch(API.quote, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(req),
  });
  return safeJson<QuoteResponse>(res);
}

/* ──────────────────────────────────────────────
   Render helpers
   ────────────────────────────────────────────── */
function formatAddress(d: Destination): string {
  const parts = [d.address1, d.address2, d.town, d.region, d.postal_code].filter(Boolean);
  return parts.length ? parts.join(", ") : "N/A";
}
function renderDestinationCard(d: Destination): string {
  const lines: string[] = [];
  lines.push(`**${d.name}** ${d.country_name ? `(${d.country_name})` : ""}`.trim());
  if (d.description) lines.push(d.description);
  lines.push(`Address: ${formatAddress(d)}`);
  lines.push(`Maps: ${d.directions_url || "N/A"}`);
  lines.push(`Phone: ${d.phone || "N/A"}`);
  lines.push(`Website: ${d.website_url || "N/A"}`);
  lines.push(`Image: ${d.image_url || "N/A"}`);
  return lines.join("\n");
}
function summarizeQuoteItem(q: QuoteItem) {
  const price = new Intl.NumberFormat("en-GB", { style: "currency", currency: q.currency || "GBP", maximumFractionDigits: 0 }).format(q.price_per_seat);
  const parts: string[] = [];
  parts.push(`• ${q.route_name} — ${price} per seat`);
  if (q.pickup_name) parts.push(`  Pickup: ${q.pickup_name}`);
  if (q.destination_name) parts.push(`  Destination: ${q.destination_name}`);
  parts.push(`  quoteToken: ${q.quoteToken}`);
  return parts.join("\n");
}

/* ──────────────────────────────────────────────
   UI Component
   ────────────────────────────────────────────── */
export default function AgentChat() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help with countries, destinations (incl. restaurants, bars, beach clubs), pickup points, transport types, and journeys.\nTry: “Show journeys in Antigua on 2025-11-20”, or “What restaurants can I visit in Antigua?”.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [catalog, setCatalog] = React.useState<Catalog>(emptyCatalog);
  const [ctx, setCtx] = React.useState<ConversationContext>({});

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const cat = await fetchVisibleCatalog().catch((e) => {
        console.error("Visible catalog error:", e);
        return emptyCatalog;
      });
      if (alive) setCatalog(cat);
    })();
    return () => { alive = false; };
  }, []);

  function push(msg: ChatMsg) { setMessages((m) => [...m, msg]); }
  function assistantSay(text: string, meta?: ChatMsg["meta"]) {
    push({ id: crypto.randomUUID(), role: "assistant", content: text, meta });
  }

  async function handleUserTurn(raw: string) {
    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content: raw };
    push(userMsg);

    const intent = detectIntent(raw);
    const surfaces = extractSurfaceEntities(raw);
    const parsed: ParsedEntities = { intent, ...surfaces };
    const resolved = resolveEntities(parsed, catalog, ctx);

    const assumeLine = (r: {country?: Country; destination?: Destination; dateISO?: string}) => {
      const bits: string[] = [];
      if (r.country?.name) bits.push(r.country.name);
      if (r.destination?.name) bits.push(r.destination.name);
      if (r.dateISO) bits.push(r.dateISO);
      return bits.length ? `Using ${bits.join(" • ")} — change?` : "";
    };

    try {
      switch (intent) {
        /* -------- Company info -------- */
        case "company": {
          const blurb = [
            "Pace Shuttles is a **fractional charter** platform: you book seats on premium transfers (boats, minibuses, etc.) to specific destinations at transparent per-seat prices.",
            "We help operators fill capacity and help restaurants/beach clubs attract guests in quieter periods with scheduled arrivals.",
            "Safety equipment is provided and support is available throughout your journey.",
          ].join(" ");
          assistantSay(`${blurb}\n\nWant to see where we operate now?`);
          return;
        }

        /* -------- Countries (STRICT routes-only) -------- */
        case "ask_countries": {
          let cat = catalog;
          if (!cat.routes.length || !cat.countries.length) {
            cat = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(cat);
          }
          if (!cat.routes.length || !cat.countries.length) {
            assistantSay("I couldn’t load the live markets just now. Please refresh and try again.");
            return;
          }
          const list = cat.countries
            .map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`)
            .join("\n");
          assistantSay(`We currently operate in:\n${list}\n\nWould you like destinations for one of these?`);
          return;
        }

        /* -------- Destinations (list by country) -------- */
        case "ask_destinations": {
          const country = resolved.country;
          if (!catalog.routes.length) {
            const fresh = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(fresh);
          }
          if (!catalog.routes.length) {
            assistantSay("I couldn’t load destinations right now. Please refresh and try again.");
            return;
          }
          if (!country) {
            const options = catalog.countries.map((c) => c.name).join(" / ");
            assistantSay(`Which country are you interested in? (${options})`);
            return;
          }
          const base = catalog.visibleDestinations;
          const dests = base.filter(
            (d) => d.country_name && d.country_name.toLowerCase() === country.name.toLowerCase()
          );
          if (!dests.length) {
            assistantSay(`I couldn’t find visible destinations in ${country.name} right now.`);
            return;
          }
          const lines = dests.map((d) => `• ${d.name}${d.description ? ` — ${d.description}` : ""}`);
          assistantSay(`Destinations in ${country.name}:\n${lines.join("\n")}\n\nWant restaurants only?`);
          setCtx((prev) => ({ ...prev, country, lastEntityKind: "country" }));
          return;
        }

        /* -------- Destination type lists -------- */
        case "ask_destinations_by_type": {
          const { destType } = resolved;
          const t = destType || detectDestinationTypeFromText(raw) || "restaurant";

          if (!catalog.routes.length) {
            const fresh = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(fresh);
          }
          if (!catalog.routes.length) {
            assistantSay("I couldn’t load destinations right now. Please refresh and try again.");
            return;
          }

          const country = resolved.country;
          const base = catalog.visibleDestinations;

          const filtered = base.filter((d) => {
            if (country && d.country_name?.toLowerCase() !== country.name.toLowerCase()) return false;
            const dt = getDestinationType(d);
            if (dt) return dt === t;
            const hay = normalize(`${d.name} ${d.description || ""}`);
            return Object.keys(TYPE_SYNONYMS).filter((k) => TYPE_SYNONYMS[k] === t).some((k) => hay.includes(k));
          });

          if (!filtered.length) {
            assistantSay(
              country
                ? `I couldn’t find any ${t}s in ${country.name} right now. Want to see all destinations, or try bars/beach clubs?`
                : `I couldn’t find any ${t}s in our list right now. Want to pick a country, or try bars/beach clubs?`
            );
            return;
          }

          const lines = filtered.slice(0, 12).map((d) => {
            const addr = formatAddress(d);
            return `• ${d.name}${d.country_name ? ` (${d.country_name})` : ""}${d.description ? ` — ${d.description}` : ""}\n  Address: ${addr}\n  Maps: ${d.directions_url || "N/A"}\n  Website: ${d.website_url || "N/A"}\n  Image: ${d.image_url || "N/A"}`;
          });

          const scope = country ? ` in ${country.name}` : "";
          assistantSay(
            `Here ${filtered.length === 1 ? "is" : "are"} ${filtered.length} ${t}${filtered.length === 1 ? "" : "s"}${scope} you can visit:\n\n${lines.join(
              "\n\n"
            )}\n\nWe also have other destination types such as **bars** and **beach clubs**. Would you like to learn more about them too?\n${assumeLine({ country })}`
          );
          setCtx((prev) => ({ ...prev, country: country ?? prev.country, lastEntityKind: country ? "country" : prev.lastEntityKind }));
          return;
        }

        /* -------- Destination info & fields -------- */
        case "dest_info":
        case "dest_address":
        case "dest_map":
        case "dest_phone":
        case "dest_website":
        case "dest_image": {
          const byName =
            (resolved.destination && resolved.destination) ||
            (parsed.destinationName && bestNameMatch(parsed.destinationName, catalog.destinationsAll)) ||
            (parsed.countryName && bestNameMatch(parsed.countryName, catalog.destinationsAll));

          if (!byName) {
            const hint = (catalog.visibleDestinations[0] || catalog.destinationsAll[0])?.name || "Catherine's Cafe";
            assistantSay(`Which destination do you mean? For example: "Tell me about '${hint}'".`);
            return;
          }

          if (intent === "dest_info") assistantSay(renderDestinationCard(byName));
          else if (intent === "dest_address") assistantSay(`**${byName.name}** address: ${formatAddress(byName)}`);
          else if (intent === "dest_map") assistantSay(`Google Maps for **${byName.name}**: ${byName.directions_url || "N/A"}`);
          else if (intent === "dest_phone") assistantSay(`Phone for **${byName.name}**: ${byName.phone || "N/A"}`);
          else if (intent === "dest_website") assistantSay(`Website for **${byName.name}**: ${byName.website_url || "N/A"}`);
          else if (intent === "dest_image") assistantSay(`Image for **${byName.name}**: ${byName.image_url || "N/A"}`);

          setCtx((prev) => ({ ...prev, destination: byName, country: resolved.country ?? prev.country, lastEntityKind: "destination" }));
          return;
        }

        /* -------- Pickups (from routes) -------- */
        case "ask_pickups": {
          const { country, destination } = resolved;

          let routes = catalog.routes;
          if (!routes.length) routes = await fetchVisibleRoutes();
          if (!routes.length) {
            assistantSay("I couldn’t load pickup points right now. Please refresh and try again.");
            return;
          }

          let pickups: string[] = [];
          if (destination?.name) {
            pickups = uniqBy(
              routes
                .filter((r) => r.destination_name && r.destination_name.toLowerCase() === destination.name!.toLowerCase())
                .filter((r) => r.pickup_name)
                .map((r) => r.pickup_name as string),
              (n) => n.toLowerCase()
            );
          } else if (country?.name) {
            pickups = uniqBy(
              routes
                .filter((r) => r.country_name && r.country_name.toLowerCase() === country.name!.toLowerCase())
                .filter((r) => r.pickup_name)
                .map((r) => r.pickup_name as string),
              (n) => n.toLowerCase()
            );
          }

          if (!pickups.length) {
            const scope = destination?.name || country?.name || "that area";
            assistantSay(`I couldn’t find visible pickup points for ${scope}.`);
            return;
          }

          assistantSay(
            `Pickup points${destination ? ` for ${destination.name}` : country ? ` in ${country.name}` : ""}:\n` +
              pickups.map((p) => `• ${p}`).join("\n") +
              `\n\nNeed Google Maps links or arrival instructions?\n${assumeLine({ country, destination })}`
          );
          setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination, lastEntityKind: destination ? "destination" : country ? "country" : prev.lastEntityKind }));
          return;
        }

        /* -------- Transport types (vehicle types) -------- */
        case "transport_types": {
          let cat = catalog;
          if (!cat.routes.length) {
            cat = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(cat);
          }
          if (!cat.routes.length) {
            assistantSay("I couldn’t load transport types right now. Please refresh and try again.");
            return;
          }
          const names = uniqBy(
            Object.values(cat.countryToVehicleTypes).flat().map((id) => cat.vehicleTypeById[id]?.name || "").filter(Boolean),
            (s) => s.toLowerCase()
          );
          if (!names.length && cat.vehicleTypes.length) {
            // fallback to raw types if mapping is empty
            for (const vt of cat.vehicleTypes) if (!names.includes(vt.name)) names.push(vt.name);
          }
          if (!names.length) {
            assistantSay("I don’t have transport types to show yet.");
            return;
          }
          assistantSay(
            `We currently operate: ${names.map(titleCase).join(", ")}.\n` +
            `Want to see where **${titleCase(names[0])}s** run, or check availability for a date?`
          );
          return;
        }

        case "transport_in_country": {
          let cat = catalog;
          if (!cat.routes.length) {
            cat = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(cat);
          }
          if (!cat.routes.length) {
            assistantSay("I couldn’t load transport types right now. Please refresh and try again.");
            return;
          }
          const country = resolved.country;
          if (!country) {
            const options = catalog.countries.map((c) => c.name).join(" / ");
            assistantSay(`Which country do you mean? (${options})`);
            return;
          }
          const vtIds = cat.countryToVehicleTypes[country.name] || [];
          if (!vtIds.length) {
            assistantSay(`I couldn’t find any active transport types for ${country.name}.`);
            return;
          }
          const names = vtIds.map((id) => cat.vehicleTypeById[id]?.name || "").filter(Boolean);
          assistantSay(
            `In ${country.name} we operate: ${names.map(titleCase).join(", ")}.\n` +
            `Pick one and I can check availability for your date.\n${assumeLine({ country })}`
          );
          setCtx((prev) => ({ ...prev, country, lastEntityKind: "country" }));
          return;
        }

        /* -------- Journeys (info / generic) -------- */
        case "journeys": {
          const { country, destination, dateISO } = resolved;
          if (!country && !destination) {
            const options = catalog.countries.map((c) => c.name).join(" / ");
            assistantSay(`Tell me a country or destination to search journeys. (${options})`);
            return;
          }
          if (!dateISO) {
            assistantSay(`Got it — ${destination ? destination.name : country?.name}. Which date? (e.g., 20/11/2025 or 2025-11-20)`);
            setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination }));
            return;
          }
          const req: QuoteRequest = {
            date: dateISO,
            country_id: destination ? undefined : (country?.id ?? null),
            destination_id: undefined,
            pickup_id: undefined,
          };
          assistantSay(`Searching journeys for ${destination ? destination.name : country?.name} on ${dateISO}…`);
          const quotes = await fetchQuotes(req).catch((err) => { console.error("quote error", err); return null; });

          if (!quotes || !quotes.items?.length) {
            assistantSay(`No journeys found for ${destination ? destination.name : country?.name} on ${dateISO}. Try another date?`);
            setCtx((prev) => ({ ...prev, country, destination, dateISO }));
            return;
          }

          const top = quotes.items.slice(0, 6).map(summarizeQuoteItem).join("\n\n");
          assistantSay(
            `Here are available journeys on ${dateISO}:\n\n${top}\n\n(Prices are per seat, incl. tax & fees — SSOT)\n${assumeLine({ country, destination, dateISO })}`
          );

          setCtx({ country, destination, dateISO, lastEntityKind: destination ? "destination" : country ? "country" : undefined });
          return;
        }

        /* -------- Availability (day/week/month) — always SSOT -------- */
        case "availability": {
          const { country, destination, dateISO } = resolved;

          if (!dateISO && !country && !destination) {
            const options = catalog.countries.map((c) => c.name).join(" / ");
            assistantSay(`Which country or destination, and which date? (${options})`);
            return;
          }

          if (!dateISO) {
            assistantSay(`Which date should I check? (e.g., 20/11/2025 or 2025-11-20)\n${assumeLine({ country, destination })}`);
            setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination }));
            return;
          }

          const req: QuoteRequest = {
            date: dateISO,
            country_id: destination ? undefined : (country?.id ?? null),
            destination_id: undefined,
            pickup_id: undefined,
          };
          assistantSay(`Checking availability for ${destination ? destination.name : country?.name || "your area"} on ${dateISO}…`);
          const quotes = await fetchQuotes(req).catch((err) => { console.error("quote error", err); return null; });

          if (!quotes || !quotes.items?.length) {
            assistantSay(`Nothing available on ${dateISO} for ${destination ? destination.name : country?.name || "that date"}. Try another date, or switch country?`);
            setCtx((prev) => ({ ...prev, country, destination, dateISO }));
            return;
          }

          const top = quotes.items.slice(0, 6).map(summarizeQuoteItem).join("\n\n");
          assistantSay(
            `I found ${quotes.items.length} option${quotes.items.length>1?"s":""} on ${dateISO}:\n\n${top}\n\nFilter by restaurants, bars, or a specific pickup?\n${assumeLine({ country, destination, dateISO })}`
          );

          setCtx({ country, destination, dateISO, lastEntityKind: destination ? "destination" : country ? "country" : undefined });
          return;
        }

        /* -------- Unknown / follow-ups -------- */
        case "unknown":
        default: {
          const onlyDate = parsed.dateISO && !parsed.countryName && !parsed.destinationName;
          if (onlyDate && (ctx.country || ctx.destination)) {
            const faux = `show journeys ${ctx.destination ? `in ${ctx.destination.name}` : ctx.country ? `in ${ctx.country.name}` : ""} on ${parsed.dateISO}`;
            await handleUserTurn(faux);
            return;
          }

          // quick context-aware fallbacks
          if (/\b(address|where is)\b/i.test(raw) && ctx.destination) {
            assistantSay(`**${ctx.destination.name}** address: ${formatAddress(ctx.destination)}`);
            return;
          }
          if (/\b(map|directions)\b/i.test(raw) && ctx.destination) {
            assistantSay(`Google Maps for **${ctx.destination.name}**: ${ctx.destination.directions_url || "N/A"}`);
            return;
          }

          let hint =
            "I can help with countries, destinations (restaurants, bars, beach clubs), pickup points, transport types, and journeys.";
          if (catalog.countries.length) {
            const sample = catalog.countries[0].name;
            hint = `Try: “What destinations do you visit in ${sample}?”, “What restaurants can I visit in ${sample}?”, or “Show journeys in ${sample} on 2025-11-20”.`;
          }
          assistantSay(hint, { entities: parsed });
          return;
        }
      }
    } catch (err: any) {
      console.error(err);
      assistantSay(`Sorry — something went wrong while processing that. ${err?.message ?? ""}`.trim());
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const val = input.trim();
    if (!val) return;
    setInput("");
    await handleUserTurn(val);
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="border rounded-2xl p-3 space-y-3 bg-white/70">
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
              <div className={m.role === "user" ? "inline-block rounded-xl px-3 py-2 bg-black text-white" : "inline-block rounded-xl px-3 py-2 bg-gray-100"}>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">{m.content}</pre>
              </div>
              {m.meta?.entities ? (
                <div className="text-xs text-gray-400 mt-1">
                  {Object.entries(m.meta.entities).map(([k, v]) => `${k}:${String(v ?? "")}`).join(" · ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask: What countries do you operate in? • What restaurants can I visit in Antigua? • Show journeys in Antigua on 2025-11-20"
            className="flex-1 border rounded-xl px-3 py-2 outline-none"
          />
          <button type="submit" className="rounded-xl px-4 py-2 bg-black text-white">Send</button>
        </form>
      </div>
    </div>
  );
}
