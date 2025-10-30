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
  hero_image_url?: string | null;
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
  type?: string | null;
  tags?: string[] | null;
  active?: boolean | null;
};

type Pickup = { name: string; country_name?: string | null; directions_url?: string | null };

type VehicleType = {
  id: UUID;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  capacity?: number | null;
  features?: string[] | null;
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
};

type VisibleCatalog = {
  ok?: boolean;
  fallback?: boolean;
  routes: VisibleRoute[];
  countries: Country[];
  destinations: Destination[];
  pickups: Pickup[];
  vehicle_types: VehicleType[];
};

type QuoteReq = { routeId: UUID; date: string; qty: number };
type QuoteItem = {
  route_id: UUID;
  route_name: string;
  destination_name?: string | null;
  pickup_name?: string | null;
  price_per_seat: number;
  currency: string;
  quoteToken: string;
  time_local?: string | null;
};
type QuoteRes = { items: QuoteItem[] };

/* ──────────────────────────────────────────────
   Config
   ────────────────────────────────────────────── */
const API_BASE = "https://www.paceshuttles.com"; // absolute to avoid preview/origin drift
const API = {
  visibleCatalog: `${API_BASE}/api/public/visible-catalog`,
  quote: `${API_BASE}/api/quote`,
};

/* ──────────────────────────────────────────────
   Utils
   ────────────────────────────────────────────── */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s\-'&]/gu, " ").replace(/\s+/g, " ").trim();
}
function uniqBy<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const v of arr) { const k = key(v); if (!seen.has(k)) { seen.add(k); out.push(v); } } return out;
}
function formatAddress(d: Destination): string {
  const parts = [d.address1, d.address2, d.town, d.region, d.postal_code].filter(Boolean);
  return parts.length ? parts.join(", ") : "N/A";
}
function money(v: number, ccy: string = "GBP") {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v); }
  catch { return `£${Math.round(v)}`; }
}

/* ──────────────────────────────────────────────
   Destination type inference
   ────────────────────────────────────────────── */
const TYPE_SYNONYMS: Record<string, string> = {
  restaurant: "restaurant", restaurants: "restaurant", cafe: "restaurant", cafés: "restaurant", caffes: "restaurant",
  bar: "bar", bars: "bar",
  "beach club": "beach club", "beach clubs": "beach club", beachclub: "beach club", beachclubs: "beach club",
  lounge: "bar", cocktail: "bar", brunch: "restaurant", lunch: "restaurant", dinner: "restaurant",
};
function getDestType(d: Destination): string | null {
  const direct =
    d.type?.toLowerCase() ||
    (Array.isArray(d.tags) ? d.tags.map((t) => t.toLowerCase()).find((t) => TYPE_SYNONYMS[t]) || null : null);
  if (direct) return TYPE_SYNONYMS[direct] || direct;
  const hay = normalize((d.name || "") + " " + (d.description || ""));
  for (const k of Object.keys(TYPE_SYNONYMS)) if (hay.includes(k)) return TYPE_SYNONYMS[k];
  return null;
}

/* ──────────────────────────────────────────────
   NLU
   ────────────────────────────────────────────── */
type Intent =
  | "ask_countries"
  | "ask_destinations"
  | "ask_destinations_by_type"
  | "dest_info" | "dest_address" | "dest_map" | "dest_phone" | "dest_website" | "dest_image"
  | "ask_pickups"
  | "transport_types" | "transport_in_country"
  | "availability" | "journeys"
  | "company"
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
    const dd = +uk[1], mm = +uk[2], yyyy = uk[3].length === 2 ? 2000 + +uk[3] : +uk[3];
    if (yyyy >= 2000 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function detectIntent(raw: string): Intent {
  const t = normalize(raw);

  // Domain-first precedence (prevents "about" from stealing destination questions)
  if (/\b(what|which|show|list|where)\b.*\bcountries?\b/.test(t)) return "ask_countries";
  if (/\b(destinations?|stops?)\b/.test(t) && /\b(in|for)\b/.test(t)) return "ask_destinations";
  if (/\b(restaurant|restaurants|bar|bars|beach ?club|beach ?clubs|cafe|caf[eé]s|lunch|dinner|brunch)\b/.test(t)) return "ask_destinations_by_type";

  if (/\b(tell me about|what is|info on|describe)\b/.test(t) && /["“”']/.test(raw)) return "dest_info";
  if (/\b(address|where is|what is the address)\b/.test(t)) return "dest_address";
  if (/\b(map|google maps|directions)\b/.test(t)) return "dest_map";
  if (/\b(phone|telephone|contact number)\b/.test(t)) return "dest_phone";
  if (/\b(website|url|link)\b/.test(t)) return "dest_website";
  if (/\b(image|photo|picture|pic)\b/.test(t)) return "dest_image";

  if (/\b(pickups?|pickup points?)\b/.test(t)) return "ask_pickups";

  if (/\b(transport|vehicle|boat|boats|helicopter|catamaran|minibus|speedboat|types?)\b/.test(t)) {
    if (/\bin\b/.test(t)) return "transport_in_country";
    return "transport_types";
  }

  if (/\b(show|find|list|any|anything|available|journeys?|routes?|book|schedule)\b/.test(t) &&
      /\b(on|today|tomorrow|this|next|week|month|date)\b/.test(t)) return "availability";

  if (/\b(show|find|list|journeys?|routes?)\b/.test(t)) return "journeys";

  if (/\b(about|what is|who are|pace shuttles|how (it )?works?)\b/.test(t)) return "company";

  return "unknown";
}

function extractEntities(raw: string): Omit<ParsedEntities, "intent"> {
  const dateISO = parseDateToISO(raw);
  const quoted = raw.match(/["“”']([^"“”']{2,80})["“”']/)?.[1]?.trim();
  const surface = raw.match(/\b(?:in|to|for)\s+([A-Za-z][A-Za-z\s&\-']{1,80})/i)?.[1]?.trim();

  // type/transport hints
  let destType: string | null = null;
  for (const k of Object.keys(TYPE_SYNONYMS)) if (normalize(raw).includes(k)) { destType = TYPE_SYNONYMS[k]; break; }
  let transportType: string | null = null;
  const tnorm = normalize(raw);
  for (const k of ["speedboat","catamaran","helicopter","minibus","bus","boat","boats"]) if (tnorm.includes(k)) { transportType = k; break; }

  return {
    dateISO,
    destinationName: quoted,
    countryName: surface,
    destType,
    transportType,
  };
}

function bestNameMatch<T extends { name: string }>(needle: string, hay: T[]): T | undefined {
  const n = normalize(needle);
  return hay.find((x) => normalize(x.name) === n) ||
         hay.find((x) => normalize(x.name).startsWith(n)) ||
         hay.find((x) => normalize(x.name).includes(n));
}

/* ──────────────────────────────────────────────
   Quotes (only valid if we have routes → routeId)
   ────────────────────────────────────────────── */
async function fetchQuote(req: QuoteReq): Promise<QuoteRes> {
  const res = await fetch(API.quote, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Quote failed ${res.status}: ${txt || res.statusText}`);
  }
  return (await res.json()) as QuoteRes;
}

/* ──────────────────────────────────────────────
   Component
   ────────────────────────────────────────────── */
type ConversationContext = {
  country?: Country;
  destination?: Destination;
  pickupName?: string;
  dateISO?: string;
  lastEntityKind?: "country" | "destination" | "pickup";
  pendingAction?: "showCountries" | null;
};

export default function AgentChat() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help with **countries**, **destinations** (restaurants, bars, beach clubs), **pickup points**, **transport types**, and **journeys**.\nTry: “What countries do you operate in?”, “What restaurants can I visit in Antigua?”, or “Show journeys in Antigua on 2025-11-20”.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [catalog, setCatalog] = React.useState<VisibleCatalog>({
    ok: false,
    fallback: true,
    routes: [],
    countries: [],
    destinations: [],
    pickups: [],
    vehicle_types: [],
  });
  const [ctx, setCtx] = React.useState<ConversationContext>({ pendingAction: null });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(API.visibleCatalog, { cache: "no-store" });
        const data = (await res.json()) as VisibleCatalog;
        if (!alive) return;
        setCatalog(data);
      } catch (e) {
        console.warn("visible-catalog load failed", (e as any)?.message || e);
      }
    })();
    return () => { alive = false; };
  }, []);

  function push(m: ChatMsg) { setMessages((s) => [...s, m]); }
  function say(text: string, meta?: ChatMsg["meta"]) { push({ id: crypto.randomUUID(), role: "assistant", content: text, meta }); }

  function hasRoutes() { return catalog.routes && catalog.routes.length > 0; }

  function handleAffirmation(raw: string): boolean {
    const t = normalize(raw);
    const isYes = ["yes","yeah","yep","ok","okay","sure","please","do","go ahead"].some((k) => t === k || t.startsWith(k));
    if (!isYes) return false;
    if (ctx.pendingAction === "showCountries") {
      showCountries();
      setCtx((p) => ({ ...p, pendingAction: null }));
      return true;
    }
    return false;
  }

  function showCountries() {
    if (!catalog.countries.length) {
      say("I couldn’t load the live markets right now. Please try again in a moment.");
      return;
    }
    const list = catalog.countries
      .map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`)
      .join("\n");
    say(`We currently operate in:\n${list}\n\nWould you like destinations for one of these?`);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    setInput("");
    push({ id: crypto.randomUUID(), role: "user", content: raw });

    // 1) Affrmation follow-through
    if (handleAffirmation(raw)) return;

    // 2) NLU
    const intent = detectIntent(raw);
    const ent0 = extractEntities(raw);

    // Resolve names to objects (countries/destinations) from catalog
    const country = ent0.countryName ? bestNameMatch(ent0.countryName, catalog.countries) : ctx.country;
    const destination = ent0.destinationName ? bestNameMatch(ent0.destinationName, catalog.destinations) : ctx.destination;
    const dateISO = ent0.dateISO ?? ctx.dateISO;

    try {
      switch (intent) {
        case "company": {
          const blurb = [
            "Pace Shuttles is a **fractional charter** platform: book seats on premium transfers (boats, minibuses, etc.) to specific destinations at transparent per-seat prices.",
            "We help operators fill capacity and help restaurants & beach clubs attract guests in quieter periods with scheduled arrivals.",
            "Safety equipment is provided and support is available throughout your journey.",
          ].join(" ");
          say(`${blurb}\n\nWant to see where we operate now?`);
          setCtx((p) => ({ ...p, pendingAction: "showCountries" }));
          return;
        }

        case "ask_countries": {
          showCountries();
          return;
        }

        case "ask_destinations": {
          if (!country) {
            const opts = catalog.countries.map((c) => c.name).join(" / ");
            say(`Which country are you interested in? (${opts || "—"})`);
            return;
          }
          const dests = catalog.destinations.filter((d) => (d.country_name || "").toLowerCase() === country.name.toLowerCase());
          if (!dests.length) {
            say(`I couldn’t find visible destinations in ${country.name} right now.`);
            return;
          }
          const lines = dests.map((d) => `• ${d.name}${d.description ? ` — ${d.description}` : ""}\n  Address: ${formatAddress(d)}\n  Maps: ${d.directions_url || "N/A"}\n  Website: ${d.website_url || "N/A"}`);
          say(`Destinations in ${country.name}:\n${lines.join("\n\n")}\n\nWant restaurants only?`);
          setCtx((p) => ({ ...p, country, lastEntityKind: "country" }));
          return;
        }

        case "ask_destinations_by_type": {
          const t = ent0.destType || "restaurant";
          const candidates = catalog.destinations.filter((d) => {
            if (country && (d.country_name || "").toLowerCase() !== country.name.toLowerCase()) return false;
            const dt = getDestType(d);
            if (dt) return dt === t;
            return false;
          });
          if (!candidates.length) {
            say(country
              ? `I couldn’t find any ${t}s in ${country.name} right now. Want to see all destinations, or try bars/beach clubs?`
              : `I couldn’t find any ${t}s right now. Pick a country, or try bars/beach clubs?`);
            return;
          }
          const lines = candidates.slice(0, 12).map((d) => `• ${d.name}${d.country_name ? ` (${d.country_name})` : ""}\n  Address: ${formatAddress(d)}\n  Maps: ${d.directions_url || "N/A"}\n  Website: ${d.website_url || "N/A"}`);
          say(`Here ${candidates.length === 1 ? "is" : "are"} ${candidates.length} ${t}${candidates.length === 1 ? "" : "s"}${country ? ` in ${country.name}` : ""} you can visit:\n\n${lines.join("\n\n")}\n\nWe also have other destination types such as **bars** and **beach clubs**. Would you like to learn more about them too?`);
          setCtx((p) => ({ ...p, country: country ?? p.country, lastEntityKind: country ? "country" : p.lastEntityKind }));
          return;
        }

        case "dest_info":
        case "dest_address":
        case "dest_map":
        case "dest_phone":
        case "dest_website":
        case "dest_image": {
          const byName = destination || (ent0.countryName && bestNameMatch(ent0.countryName, catalog.destinations));
          if (!byName) {
            const hint = (catalog.destinations[0]?.name) || "Catherine's Cafe";
            say(`Which destination do you mean? For example: "Tell me about '${hint}'".`);
            return;
          }
          if (intent === "dest_info") {
            say([
              `**${byName.name}** ${byName.country_name ? `(${byName.country_name})` : ""}`.trim(),
              byName.description || "",
              `Address: ${formatAddress(byName)}`,
              `Maps: ${byName.directions_url || "N/A"}`,
              `Phone: ${byName.phone || "N/A"}`,
              `Website: ${byName.website_url || "N/A"}`,
              `Image: ${byName.image_url || "N/A"}`,
            ].filter(Boolean).join("\n"));
          } else if (intent === "dest_address") say(`**${byName.name}** address: ${formatAddress(byName)}`);
          else if (intent === "dest_map") say(`Google Maps for **${byName.name}**: ${byName.directions_url || "N/A"}`);
          else if (intent === "dest_phone") say(`Phone for **${byName.name}**: ${byName.phone || "N/A"}`);
          else if (intent === "dest_website") say(`Website for **${byName.name}**: ${byName.website_url || "N/A"}`);
          else if (intent === "dest_image") say(`Image for **${byName.name}**: ${byName.image_url || "N/A"}`);

          setCtx((p) => ({ ...p, destination: byName, country: country ?? p.country, lastEntityKind: "destination" }));
          return;
        }

        case "ask_pickups": {
          const scopeCountry = country;
          const scopeDest = destination;
          // Without routes, we can only list pickup names from catalog if present
          let pickups: string[] = [];

          if (scopeDest) {
            const routePickups = catalog.routes
              .filter((r) => r.destination_name && r.destination_name.toLowerCase() === scopeDest.name.toLowerCase())
              .map((r) => r.pickup_name)
              .filter(Boolean) as string[];
            pickups = uniqBy(routePickups, (x) => x.toLowerCase());
          }
          if (!pickups.length && scopeCountry) {
            const routePickups = catalog.routes
              .filter((r) => r.country_name && r.country_name.toLowerCase() === scopeCountry.name.toLowerCase())
              .map((r) => r.pickup_name)
              .filter(Boolean) as string[];
            pickups = uniqBy(routePickups, (x) => x.toLowerCase());
          }
          if (!pickups.length) {
            // fallback to generic list if provided
            pickups = uniqBy(
              catalog.pickups
                .filter((p) => !scopeCountry || (p.country_name || "").toLowerCase() === scopeCountry.name.toLowerCase())
                .map((p) => p.name),
              (x) => x.toLowerCase()
            );
          }

          if (!pickups.length) {
            say(`I couldn’t find pickup points for ${scopeDest?.name || scopeCountry?.name || "that area"} right now.`);
            return;
          }
          say(`Pickup points${scopeDest ? ` for ${scopeDest.name}` : scopeCountry ? ` in ${scopeCountry.name}` : ""}:\n` + pickups.map((p) => `• ${p}`).join("\n") + `\n\nNeed Google Maps links or arrival instructions?`);
          setCtx((p) => ({ ...p, country: scopeCountry ?? p.country, destination: scopeDest ?? p.destination, lastEntityKind: scopeDest ? "destination" : scopeCountry ? "country" : p.lastEntityKind }));
          return;
        }

        case "transport_types": {
          const names = uniqBy(
            (catalog.vehicle_types || []).map((t) => t.name).filter(Boolean),
            (s) => s.toLowerCase()
          );
          if (!names.length) { say("I don’t have transport types to show yet."); return; }
          say(`We currently operate: ${names.join(", ")}.\nWant to see where **${names[0]}s** run, or check availability for a date?`);
          return;
        }

        case "transport_in_country": {
          if (!country) { const opts = catalog.countries.map((c) => c.name).join(" / "); say(`Which country do you mean? (${opts || "—"})`); return; }
          // Derive types used in that country from routes (if present)
          const typeNames = uniqBy(
            catalog.routes.filter((r) => (r.country_name || "").toLowerCase() === country.name.toLowerCase())
              .map((r) => r.vehicle_type_name || "").filter(Boolean),
              (s) => s.toLowerCase()
          );
          const fallback = !typeNames.length ? catalog.vehicle_types.map((v) => v.name) : typeNames;
          if (!fallback.length) { say(`I couldn’t find transport types for ${country.name}.`); return; }
          say(`In ${country.name} we operate: ${fallback.join(", ")}.\nPick one and I can check availability for your date.`);
          setCtx((p) => ({ ...p, country, lastEntityKind: "country" }));
          return;
        }

        case "journeys":
        case "availability": {
          if (!hasRoutes()) {
            say("I can list countries, destinations and pickup info right now, but I don’t yet have live route IDs for pricing. Once the live catalog is wired, I’ll show availability and per-seat prices here.");
            return;
          }
          if (!dateISO) {
            const scope = destination?.name || country?.name || "your area";
            say(`Which date should I check ${scope}? (e.g., 20/11/2025 or 2025-11-20)`);
            setCtx((p) => ({ ...p, country: country ?? p.country, destination: destination ?? p.destination }));
            return;
          }

          // Minimal route selection: all routes in selected country/destination
          const routes = catalog.routes.filter((r) => {
            if (destination) return (r.destination_name || "").toLowerCase() === destination.name.toLowerCase();
            if (country) return (r.country_name || "").toLowerCase() === country.name.toLowerCase();
            return true;
          });
          if (!routes.length) { say(`No journeys found for ${destination?.name || country?.name || "that area"} right now.`); return; }

          const results: QuoteItem[] = [];
          for (const r of routes.slice(0, 8)) {
            try {
              const q = await fetchQuote({ routeId: r.route_id, date: dateISO, qty: 1 });
              for (const it of (q.items || [])) results.push(it);
            } catch {
              /* ignore route-level failures */
            }
          }
          if (!results.length) { say(`No availability on ${dateISO} for ${destination?.name || country?.name || "that day"}. Try another date?`); return; }

          const lines = results.slice(0, 8).map((q) => {
            const price = money(q.price_per_seat, q.currency || "GBP");
            const parts: string[] = [];
            parts.push(`• ${q.route_name} — ${price} per seat`);
            if (q.pickup_name) parts.push(`  Pickup: ${q.pickup_name}`);
            if (q.destination_name) parts.push(`  Destination: ${q.destination_name}`);
            if (q.time_local) parts.push(`  Time: ${q.time_local}`);
            parts.push(`  quoteToken: ${q.quoteToken}`);
            return parts.join("\n");
          });
          say(`I found ${results.length} option${results.length > 1 ? "s" : ""} on ${dateISO}:\n\n${lines.join("\n\n")}\n\nFilter by restaurants, bars, or a specific pickup?`);
          setCtx({ country, destination, dateISO, lastEntityKind: destination ? "destination" : country ? "country" : undefined, pendingAction: null });
          return;
        }

        case "unknown":
        default: {
          // helpful fallback based on context
          if (ctx.destination && /\b(address|where is)\b/i.test(raw)) { say(`**${ctx.destination.name}** address: ${formatAddress(ctx.destination)}`); return; }
          if (ctx.destination && /\b(map|directions)\b/i.test(raw)) { say(`Google Maps for **${ctx.destination.name}**: ${ctx.destination.directions_url || "N/A"}`); return; }
          const hint = catalog.countries.length
            ? `Try: “What destinations do you visit in ${catalog.countries[0].name}?”, “What restaurants can I visit in ${catalog.countries[0].name}?”, or “Show journeys in ${catalog.countries[0].name} on 2025-11-20”.`
            : "I can help with countries, destinations (restaurants, bars, beach clubs), pickup points, transport types, and journeys.";
          say(hint, { entities: { intent, ...ent0 } });
          return;
        }
      }
    } catch (err: any) {
      console.error("Agent error:", err?.message || err);
      say(`Sorry — something went wrong. ${err?.message ?? ""}`.trim());
    }
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
            placeholder="Ask: Countries • Destinations in Antigua • Restaurants • Pickups • Transport types • Journeys on 2025-11-20"
            className="flex-1 border rounded-xl px-3 py-2 outline-none"
          />
          <button type="submit" className="rounded-xl px-4 py-2 bg-black text-white">Send</button>
        </form>

        {!hasRoutes() && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Live route IDs aren’t available yet, so I’ll list countries/destinations/types and pickup info.
            Wire <code>/api/public/visible-catalog</code> to the homepage loader to enable per-seat prices and availability.
          </div>
        )}
      </div>
    </div>
  );
}
