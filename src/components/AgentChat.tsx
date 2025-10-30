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
  active?: boolean | null;
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
  country_description?: string | null;
  destination_description?: string | null;
  pickup_description?: string | null;
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
  visibleCountries: "/api/public/visible-countries",      // optional helper
  visibleRoutesPreferred: "/api/public/routes?onlyVisible=1",
  visibleRoutesCandidates: [
    "/api/public/routes?onlyVisible=1",
    "/api/public/routes?visible=1",
    "/api/public/routes",
  ],
  destinations: "/api/public/destinations",
  countriesAll: "/api/public/countries",
  quote: "/api/quote",
};

/* ──────────────────────────────────────────────
   JSON helpers (tolerant)
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

/* ──────────────────────────────────────────────
   Normalization + type inference
   ────────────────────────────────────────────── */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s\-&']/gu, " ").replace(/\s+/g, " ").trim();
}

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
   Catalogue (VISIBLE scope + destination details)
   ────────────────────────────────────────────── */
type Catalog = {
  countries: Country[];
  destinationsAll: Destination[];
  visibleDestinations: Destination[];
  routes: VisibleRoute[];
};
const emptyCatalog: Catalog = { countries: [], destinationsAll: [], visibleDestinations: [], routes: [] };

async function fetchVisibleRoutes(): Promise<VisibleRoute[]> {
  for (const url of API.visibleRoutesCandidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const rows = await jsonArray<VisibleRoute>(res);
      if (rows?.length) return rows;
      // if array but empty, try next candidate
    } catch {
      // try next candidate
    }
  }
  return []; // all candidates failed
}

async function fetchAllCountriesFallback(): Promise<Country[]> {
  try {
    const res = await fetch(API.countriesAll, { cache: "no-store" });
    const rows = await jsonArray<Country>(res);
    // Prefer active ones if present
    const active = rows.filter((c: any) => c?.active !== false);
    return active.length ? active : rows;
  } catch {
    return [];
  }
}

async function fetchVisibleCatalog(): Promise<Catalog> {
  // 1) Fetch visible routes (multi-probe)
  const routes = await fetchVisibleRoutes();

  // 2) Try explicit visible countries
  let countries: Country[] = [];
  try {
    const vcRes = await fetch(API.visibleCountries, { cache: "no-store" });
    const maybe = await jsonArray<Country>(vcRes);
    if (maybe?.length) countries = maybe;
  } catch {
    // ignore
  }

  // 3) Derive from routes when needed
  if (!countries.length && routes.length) {
    countries = uniqBy(
      routes
        .filter((r) => r.country_name)
        .map((r) => ({
          id: r.country_id ?? null,
          name: r.country_name || "Unknown",
          description: r.country_description ?? null,
        })),
      (c) => (c.id ?? c.name ?? "").toString().toLowerCase()
    );
  }

  // 4) Last-resort: fall back to all countries (so the question still gets an answer)
  if (!countries.length) {
    countries = await fetchAllCountriesFallback();
  }

  // 5) Destinations (full info), then filter to visible by name
  let destinationsAll: Destination[] = [];
  try {
    const dRes = await fetch(API.destinations, { cache: "no-store" });
    destinationsAll = await jsonArray<Destination>(dRes);
  } catch {
    destinationsAll = [];
  }

  const visibleDestNameSet = new Set(
    routes.filter((r) => r.destination_name).map((r) => (r.destination_name || "").toLowerCase())
  );
  const visibleDestinations =
    routes.length && visibleDestNameSet.size
      ? destinationsAll.filter((d) => d.name && visibleDestNameSet.has(d.name.toLowerCase()))
      : destinationsAll; // if we couldn't load routes, show all destinations rather than nothing

  return { countries, destinationsAll, visibleDestinations, routes };
}

/* ──────────────────────────────────────────────
   NLU — intents & slot extraction
   ────────────────────────────────────────────── */
type Intent =
  | "journeys"
  | "ask_countries"
  | "ask_destinations"
  | "ask_pickups"
  | "ask_destinations_by_type"
  | "dest_info"
  | "dest_address"
  | "dest_map"
  | "dest_phone"
  | "dest_website"
  | "dest_image"
  | "unknown";

type ParsedEntities = {
  intent?: Intent;
  countryName?: string;
  destinationName?: string;
  dateISO?: string;
  destType?: string | null;
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

  if (/\b(restaurant|restaurants|bar|bars|beach ?club|beach ?clubs|cafe|caf[eé]s|lunch|dinner|brunch)\b/.test(t) &&
      /\b(what|which|show|list|where)\b/.test(t)) return "ask_destinations_by_type";

  if (/\b(tell me about|what is|info on|describe)\b/.test(t)) return "dest_info";
  if (/\b(address|where is|what is the address)\b/.test(t)) return "dest_address";
  if (/\b(map|google maps|directions)\b/.test(t)) return "dest_map";
  if (/\b(phone|telephone|contact number)\b/.test(t)) return "dest_phone";
  if (/\b(website|url|link)\b/.test(t)) return "dest_website";
  if (/\b(image|photo|picture|pic)\b/.test(t)) return "dest_image";

  if (/\b(what|which)\b.*\bcountries?\b/.test(t)) return "ask_countries";
  if (/\b(destinations?|stops?)\b/.test(t) && /\bin\b/.test(t)) return "ask_destinations";
  if (/\b(pickups?|pickup points?)\b/.test(t)) return "ask_pickups";

  if (/\b(show|find|list|any|anything|available|journeys?|routes?|book)\b/.test(t)) return "journeys";

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

  return { countryName: surface || undefined, destinationName: quotedName, dateISO, destType };
}

function bestNameMatch<T extends { name: string }>(name: string, items: T[]): T | undefined {
  const n = normalize(name);
  return items.find((i) => normalize(i.name) === n)
      || items.find((i) => normalize(i.name).startsWith(n))
      || items.find((i) => normalize(i.name).includes(n));
}

type ConversationContext = { country?: Country; destination?: Destination; dateISO?: string };

function resolveEntities(
  parsed: ParsedEntities,
  catalog: Catalog,
  ctx: ConversationContext
): { country?: Country; destination?: Destination; dateISO?: string; destType?: string | null } {
  let country: Country | undefined;
  let destination: Destination | undefined;
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
  return { country, destination, dateISO, destType: parsed.destType ?? null };
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
   UI
   ────────────────────────────────────────────── */
export default function AgentChat() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help with countries, destinations (incl. restaurants, bars, beach clubs), pickup points, and journeys.\nTry: “Show journeys in Antigua on 2025-11-20”, or “What restaurants can I visit in Antigua?”.",
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

    try {
      switch (intent) {
        /* -------- Countries (visible; with resilient fallbacks) -------- */
        case "ask_countries": {
          // If empty, refresh catalogue; if still empty, direct fallback to all countries
          let listCountries = catalog.countries;
          if (!listCountries.length) {
            const fresh = await fetchVisibleCatalog().catch(() => emptyCatalog);
            setCatalog(fresh);
            listCountries = fresh.countries;
            if (!listCountries.length) {
              listCountries = await fetchAllCountriesFallback();
            }
          }
          if (!listCountries.length) {
            assistantSay("I couldn’t load countries right now. Please try again.");
            return;
          }
          const list = listCountries.map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n");
          assistantSay(`We currently operate in:\n${list}`);
          return;
        }

        /* -------- Destinations (visible list) -------- */
        case "ask_destinations": {
          const country = resolved.country;
          if (!country) {
            assistantSay(`Which country are you interested in? (e.g., “What destinations do you visit in Antigua?”)`);
            return;
          }
          const base = catalog.visibleDestinations.length ? catalog.visibleDestinations : catalog.destinationsAll;
          const dests = base.filter((d) => d.country_name && d.country_name.toLowerCase() === country.name.toLowerCase());
          if (!dests.length) {
            assistantSay(`I couldn’t find destinations in ${country.name} right now.`);
            return;
          }
          const lines = dests.map((d) => `• ${d.name}${d.description ? ` — ${d.description}` : ""}`);
          assistantSay(`Destinations in ${country.name}:\n${lines.join("\n")}`);
          setCtx((prev) => ({ ...prev, country }));
          return;
        }

        /* -------- Destination type lists (restaurants/bars/beach clubs) -------- */
        case "ask_destinations_by_type": {
          const { destType } = resolved;
          const t = destType || detectDestinationTypeFromText(raw) || "restaurant";
          const country = resolved.country;
          const base = catalog.visibleDestinations.length ? catalog.visibleDestinations : catalog.destinationsAll;

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
                ? `I couldn’t find any ${t}s in ${country.name} right now. Would you like to see all destinations, or try a different type (bars, beach clubs)?`
                : `I couldn’t find any ${t}s in our list right now. Would you like to pick a country, or try a different type (bars, beach clubs)?`
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
            )}\n\nWe also have other destination types such as **bars** and **beach clubs**. Would you like to learn more about them too?`
          );
          setCtx((prev) => ({ ...prev, country: country ?? prev.country }));
          return;
        }

        /* -------- Destination info (address/map/phone/website/image) -------- */
        case "dest_info":
        case "dest_address":
        case "dest_map":
        case "dest_phone":
        case "dest_website":
        case "dest_image": {
          const byName =
            (parsed.destinationName && bestNameMatch(parsed.destinationName, catalog.destinationsAll)) ||
            (parsed.countryName && bestNameMatch(parsed.countryName, catalog.destinationsAll)) ||
            resolved.destination;

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

          setCtx((prev) => ({ ...prev, destination: byName, country: resolved.country ?? prev.country }));
          return;
        }

        /* -------- Pickups (derived from routes) -------- */
        case "ask_pickups": {
          const { country, destination } = resolved;
          const routes = catalog.routes.length ? catalog.routes : await fetchVisibleRoutes();

          let pickupsForScope: string[] = [];
          if (destination?.name) {
            pickupsForScope = uniqBy(
              routes
                .filter((r) => r.destination_name && r.destination_name.toLowerCase() === destination.name!.toLowerCase())
                .filter((r) => r.pickup_name)
                .map((r) => r.pickup_name as string),
              (n) => n.toLowerCase()
            );
          } else if (country?.name) {
            pickupsForScope = uniqBy(
              routes
                .filter((r) => r.country_name && r.country_name.toLowerCase() === country.name!.toLowerCase())
                .filter((r) => r.pickup_name)
                .map((r) => r.pickup_name as string),
              (n) => n.toLowerCase()
            );
          }

          if (!pickupsForScope.length) {
            const scope = destination?.name || country?.name || "that area";
            assistantSay(`I couldn’t find visible pickup points for ${scope}.`);
            return;
          }

          assistantSay(
            `Pickup points${destination ? ` for ${destination.name}` : country ? ` in ${country.name}` : ""}:\n` +
              pickupsForScope.map((p) => `• ${p}`).join("\n")
          );
          setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination }));
          return;
        }

        /* -------- Journeys (SSOT) -------- */
        case "journeys": {
          const { country, destination, dateISO } = resolved;

          if (!country && !destination) {
            assistantSay(
              `Tell me a country or destination to search journeys.\nFor example: “Show journeys in Antigua on 2025-11-20”.`,
              { entities: parsed }
            );
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
          const quotes = await fetchQuotes(req).catch((err) => {
            console.error("quote error", err);
            return null;
          });

          if (!quotes || !quotes.items?.length) {
            assistantSay(`No journeys found for ${destination ? destination.name : country?.name} on ${dateISO}. Try another date.`);
            setCtx((prev) => ({ ...prev, country, destination, dateISO }));
            return;
          }

          const top = quotes.items.slice(0, 6).map(summarizeQuoteItem).join("\n\n");
          assistantSay(
            `Here are available journeys on ${dateISO}:\n\n${top}\n\n(Prices are per seat, incl. tax & fees — SSOT)`,
            { summary: "SSOT quotes", entities: { ...parsed, dateISO } }
          );

          setCtx({ country, destination, dateISO });
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

          if (/\b(address|where is)\b/i.test(raw) && ctx.destination) {
            assistantSay(`**${ctx.destination.name}** address: ${formatAddress(ctx.destination)}`);
            return;
          }
          if (/\b(map|directions)\b/i.test(raw) && ctx.destination) {
            assistantSay(`Google Maps for **${ctx.destination.name}**: ${ctx.destination.directions_url || "N/A"}`);
            return;
          }
          if (/\b(phone|telephone)\b/i.test(raw) && ctx.destination) {
            assistantSay(`Phone for **${ctx.destination.name}**: ${ctx.destination.phone || "N/A"}`);
            return;
          }
          if (/\b(website|url|link)\b/i.test(raw) && ctx.destination) {
            assistantSay(`Website for **${ctx.destination.name}**: ${ctx.destination.website_url || "N/A"}`);
            return;
          }
          if (/\b(image|photo|picture)\b/i.test(raw) && ctx.destination) {
            assistantSay(`Image for **${ctx.destination.name}**: ${ctx.destination.image_url || "N/A"}`);
            return;
          }

          let hint =
            "I can help with countries, destinations (restaurants, bars, beach clubs), pickup points, and journeys.";
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
