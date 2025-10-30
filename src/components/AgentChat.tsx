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

type Country = { id?: UUID | null; name: string; description?: string | null; slug?: string | null; active?: boolean | null };
type Destination = {
  // Public /destinations payload (no IDs in your sample)
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
};
type Pickup = { id: UUID; country_id: UUID; destination_id: UUID | null; name: string; description?: string | null; slug?: string | null };

/* Homepage-visible routes (only those we can actually sell/show) */
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

/* SSOT quotes */
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
  visibleCountries: "/api/public/visible-countries", // optional helper
  visibleRoutes: "/api/public/routes?onlyVisible=1",  // homepage SSOT for visibility
  destinations: "/api/public/destinations",           // info-rich payload
  pickups: "/api/public/pickups",                     // if needed as a fallback
  quote: "/api/quote",                                // SSOT prices/availability
};

/* ──────────────────────────────────────────────
   Helpers: tolerant JSON unwrapping
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
   Catalogue (VISIBLE scope + destination details)
   ────────────────────────────────────────────── */
type Catalog = {
  countries: Country[];
  destinationsAll: Destination[]; // raw API list (for details)
  visibleDestinations: Destination[]; // filtered to visible routes
  pickups: Pickup[];
  routes: VisibleRoute[];
};
const emptyCatalog: Catalog = { countries: [], destinationsAll: [], visibleDestinations: [], pickups: [], routes: [] };

async function fetchVisibleCatalog(): Promise<Catalog> {
  // Core: visible routes
  const routesRes = await fetch(API.visibleRoutes, { cache: "no-store" });
  const routes = await jsonArray<VisibleRoute>(routesRes);

  // Try explicit visible countries
  let countries: Country[] = [];
  try {
    const vcRes = await fetch(API.visibleCountries, { cache: "no-store" });
    countries = await jsonArray<Country>(vcRes);
  } catch {
    // derive from routes
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

  // Full destinations payload (for rich info)
  let destinationsAll: Destination[] = [];
  try {
    const dRes = await fetch(API.destinations, { cache: "no-store" });
    destinationsAll = await jsonArray<Destination>(dRes);
  } catch {
    destinationsAll = [];
  }

  // Restrict to visible destinations (present in visible routes by name)
  const visibleDestNameSet = new Set(
    routes.filter((r) => r.destination_name).map((r) => (r.destination_name || "").toLowerCase())
  );
  const visibleDestinations = destinationsAll.filter((d) =>
    d.name ? visibleDestNameSet.has(d.name.toLowerCase()) : false
  );

  return { countries, destinationsAll, visibleDestinations, pickups: [], routes };
}

/* ──────────────────────────────────────────────
   NLU — intents & slot extraction
   ────────────────────────────────────────────── */
type Intent =
  | "journeys"
  | "ask_countries"
  | "ask_destinations"
  | "ask_pickups"
  | "dest_info"        // tell me about X
  | "dest_address"     // what's the address for X?
  | "dest_map"         // maps link
  | "dest_phone"
  | "dest_website"
  | "dest_image"
  | "unknown";

type ParsedEntities = {
  intent?: Intent;
  countryName?: string;
  destinationName?: string;
  pickupName?: string;
  dateISO?: string;
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s\-&']/gu, " ").replace(/\s+/g, " ").trim();
}
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

  // Destination info patterns
  if (/\b(tell me about|what is|info on|describe)\b/.test(t) && /\b(catherine|boom|shirley|cliff|hut|reef|nobu|prickly|loose)\b/.test(t))
    return "dest_info";
  if (/\b(address|where is|what is the address)\b/.test(t)) return "dest_address";
  if (/\b(map|google maps|directions)\b/.test(t)) return "dest_map";
  if (/\b(phone|telephone|contact number)\b/.test(t)) return "dest_phone";
  if (/\b(website|url|link)\b/.test(t)) return "dest_website";
  if (/\b(image|photo|picture|pic)\b/.test(t)) return "dest_image";

  // Catalogue queries
  if (/\b(what|which)\b.*\bcountries?\b/.test(t)) return "ask_countries";
  if (/\b(destinations?|stops?)\b/.test(t) && /\bin\b/.test(t)) return "ask_destinations";
  if (/\b(pickups?|pickup points?)\b/.test(t)) return "ask_pickups";

  // Journeys / availability
  if (/\b(show|find|list|any|anything|available|journeys?|routes?|book)\b/.test(t)) return "journeys";

  return "unknown";
}

function extractSurfaceEntities(raw: string): Omit<ParsedEntities, "intent"> {
  const dateISO = parseDateToISO(raw);
  // Capture thing after "in" or "to"
  const inMatch = raw.match(/\b(?:in|to)\s+([A-Za-z][A-Za-z\s&\-']{1,80})/i);
  const surface = inMatch?.[1]?.trim();
  const surfaceTrimmed = surface?.replace(/\s+on\s+.*$/i, "").trim();

  // Also capture a quoted destination name: "Catherine's Cafe"
  const quoted = raw.match(/["“”']([^"“”']{2,80})["“”']/);
  const quotedName = quoted?.[1]?.trim();

  return {
    countryName: surfaceTrimmed,
    destinationName: quotedName,
    dateISO,
  };
}

function bestNameMatch<T extends { name: string }>(name: string, items: T[]): T | undefined {
  const n = normalize(name);
  let exact = items.find((i) => normalize(i.name) === n);
  if (exact) return exact;
  let starts = items.find((i) => normalize(i.name).startsWith(n));
  if (starts) return starts;
  return items.find((i) => normalize(i.name).includes(n));
}

type ConversationContext = { country?: Country; destination?: Destination; pickup?: Pickup; dateISO?: string };

/* Resolve to visible-only world first; use full destination list to fill details */
function resolveEntities(
  parsed: ParsedEntities,
  catalog: Catalog,
  ctx: ConversationContext
): { country?: Country; destination?: Destination; dateISO?: string } {
  let country: Country | undefined;
  let destination: Destination | undefined;
  const dateISO = parsed.dateISO ?? ctx.dateISO ?? undefined;

  // Prefer explicit destination match (quoted or name) against visibleDestinations first
  const destNameCandidate = parsed.destinationName || parsed.countryName; // sometimes users write "in Boom"
  if (destNameCandidate) {
    destination = bestNameMatch(destNameCandidate, catalog.visibleDestinations);
    if (!destination) {
      // Try the full list (still ok for info fetches)
      destination = bestNameMatch(destNameCandidate, catalog.destinationsAll);
    }
  }

  // Country match only within visible countries
  if (parsed.countryName && !destination) {
    country = bestNameMatch(parsed.countryName, catalog.countries);
  }

  // Backfill from context
  if (!country && ctx.country) country = ctx.country;
  if (!destination && ctx.destination) destination = ctx.destination;

  // If we found a destination, infer its country from name match
  if (!country && destination?.country_name) {
    country = bestNameMatch(destination.country_name, catalog.countries);
  }

  return { country, destination, dateISO };
}

/* ──────────────────────────────────────────────
   Quote fetch (SSOT)
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
   Destination detail rendering
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

/* ──────────────────────────────────────────────
   UI Component
   ────────────────────────────────────────────── */
export default function AgentChat() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help with countries, destinations, pickup points, and journeys.\nTry: “Show journeys in Antigua on 2025-11-20”, or “Tell me about Catherine’s Cafe”.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [catalog, setCatalog] = React.useState<Catalog>(emptyCatalog);
  const [ctx, setCtx] = React.useState<ConversationContext>({});

  React.useEffect(() => {
    let alive = true;
    fetchVisibleCatalog()
      .then((cat) => {
        if (!alive) return;
        setCatalog(cat);
      })
      .catch((err) => {
        console.error("Visible catalog fetch error:", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  function push(msg: ChatMsg) {
    setMessages((m) => [...m, msg]);
  }
  function assistantSay(text: string, meta?: ChatMsg["meta"]) {
    push({ id: crypto.randomUUID(), role: "assistant", content: text, meta });
  }
  function summarizeQuoteItem(q: QuoteItem) {
    const price = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: q.currency || "GBP",
      maximumFractionDigits: 0,
    }).format(q.price_per_seat);
    const parts: string[] = [];
    parts.push(`• ${q.route_name} — ${price} per seat`);
    if (q.pickup_name) parts.push(`  Pickup: ${q.pickup_name}`);
    if (q.destination_name) parts.push(`  Destination: ${q.destination_name}`);
    parts.push(`  quoteToken: ${q.quoteToken}`);
    return parts.join("\n");
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
        /* ───────── Countries (visible only) ───────── */
        case "ask_countries": {
          if (!catalog.countries.length) {
            try {
              const fresh = await fetchVisibleCatalog();
              setCatalog(fresh);
              if (fresh.countries.length) {
                const list = fresh.countries.map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n");
                assistantSay(`We currently operate in:\n${list}`);
                return;
              }
            } catch {}
            assistantSay("I couldn’t load visible countries right now. Please try again.");
            return;
          }
          const list = catalog.countries.map((c) => `• ${c.name}${c.description ? ` — ${c.description}` : ""}`).join("\n");
          assistantSay(`We currently operate in:\n${list}`);
          return;
        }

        /* ───────── Destinations list (visible only) ───────── */
        case "ask_destinations": {
          const country = resolved.country;
          if (!country) {
            assistantSay(`Which country are you interested in? (e.g., “What destinations do you visit in Antigua?”)`);
            return;
          }
          const dests = catalog.visibleDestinations.filter((d) =>
            d.country_name ? d.country_name.toLowerCase() === country.name.toLowerCase() : false
          );
          if (!dests.length) {
            assistantSay(`I couldn’t find visible destinations in ${country.name} right now.`);
            return;
          }
          const lines = dests.map((d) => `• ${d.name}${d.description ? ` — ${d.description}` : ""}`);
          assistantSay(`Destinations in ${country.name}:\n${lines.join("\n")}`);
          setCtx((prev) => ({ ...prev, country }));
          return;
        }

        /* ───────── Destination info (rich, from /destinations) ───────── */
        case "dest_info":
        case "dest_address":
        case "dest_map":
        case "dest_phone":
        case "dest_website":
        case "dest_image": {
          // Decide which destination we’re talking about:
          const byName =
            (parsed.destinationName && bestNameMatch(parsed.destinationName, catalog.destinationsAll)) ||
            (parsed.countryName && bestNameMatch(parsed.countryName, catalog.destinationsAll)) ||
            ctx.destination;

          if (!byName) {
            // Try to infer from last visible destination list (first item as hint)
            const hint = catalog.visibleDestinations[0]?.name || "Catherine's Cafe";
            assistantSay(`Which destination do you mean? For example: "Tell me about \"${hint}\"".`);
            return;
          }

          // Build answer depending on the sub-intent
          if (intent === "dest_info") {
            assistantSay(renderDestinationCard(byName));
          } else if (intent === "dest_address") {
            assistantSay(`**${byName.name}** address: ${formatAddress(byName)}`);
          } else if (intent === "dest_map") {
            assistantSay(`Google Maps for **${byName.name}**: ${byName.directions_url || "N/A"}`);
          } else if (intent === "dest_phone") {
            assistantSay(`Phone for **${byName.name}**: ${byName.phone || "N/A"}`);
          } else if (intent === "dest_website") {
            assistantSay(`Website for **${byName.name}**: ${byName.website_url || "N/A"}`);
          } else if (intent === "dest_image") {
            assistantSay(`Image for **${byName.name}**: ${byName.image_url || "N/A"}`);
          }

          // Update context
          setCtx((prev) => ({ ...prev, destination: byName, country: resolved.country ?? prev.country }));
          return;
        }

        /* ───────── Pickups (derive from visible routes by destination/country) ───────── */
        case "ask_pickups": {
          const { country, destination } = resolved;

          // If a destination is known, show pickups tied to routes for that destination
          let pickupsForScope: string[] = [];
          if (destination?.name) {
            pickupsForScope = uniqBy(
              catalog.routes
                .filter((r) => r.destination_name && r.destination_name.toLowerCase() === destination.name.toLowerCase())
                .filter((r) => r.pickup_name)
                .map((r) => r.pickup_name as string),
              (n) => n.toLowerCase()
            );
          } else if (country?.name) {
            pickupsForScope = uniqBy(
              catalog.routes
                .filter((r) => r.country_name && r.country_name.toLowerCase() === country.name.toLowerCase())
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

          assistantSay(`Pickup points${destination ? ` for ${destination.name}` : country ? ` in ${country.name}` : ""}:\n` + pickupsForScope.map((p) => `• ${p}`).join("\n"));
          setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination }));
          return;
        }

        /* ───────── Journeys / quotes (SSOT) ───────── */
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
            destination_id: undefined, // we don’t have destination IDs in public API; SSOT can still filter via country/pickup/date
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

        /* ───────── Unknown / follow-up handling ───────── */
        case "unknown":
        default: {
          // Date-only follow-up (“anything on 12/11/25”) reusing context
          const onlyDate = parsed.dateISO && !parsed.countryName && !parsed.destinationName;
          if (onlyDate && (ctx.country || ctx.destination)) {
            const faux = `show journeys ${ctx.destination ? `in ${ctx.destination.name}` : ctx.country ? `in ${ctx.country.name}` : ""} on ${parsed.dateISO}`;
            await handleUserTurn(faux);
            return;
          }

          // If user asked “what’s the address?” after a previous destination context
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

          // Context-aware hints
          let hint = "I can help with countries, destinations, pickup points, and journeys.";
          if (catalog.countries.length) {
            const sample = catalog.countries[0].name;
            hint = `Try: “What destinations do you visit in ${sample}?”, “Tell me about 'Catherine’s Cafe'”, or “Show journeys in ${sample} on 2025-11-20”.`;
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
                  {Object.entries(m.meta.entities)
                    .map(([k, v]) => `${k}:${String(v ?? "")}`)
                    .join(" · ")}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about destinations (e.g., Tell me about 'Catherine’s Cafe') or journeys (Show journeys in Antigua on 2025-11-20)"
            className="flex-1 border rounded-xl px-3 py-2 outline-none"
          />
          <button type="submit" className="rounded-xl px-4 py-2 bg-black text-white">Send</button>
        </form>
      </div>
    </div>
  );
}
