// src/components/AgentChat.tsx
"use client";

import * as React from "react";

/* ──────────────────────────────────────────────
   Types (preserved + extended)
   ────────────────────────────────────────────── */
type SourceLink = { title: string; section?: string | null; url?: string | null };

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceLink[];
  meta?: {
    clarify?: boolean;
    expect?: string | null; // server suggests the next expected intent
    requireLogin?: boolean;
    mode?: "anon" | "signed";
    usedSnippets?: number;
    summary?: string;
    // NEW: parsed entities snapshot for debugging
    entities?: Partial<ParsedEntities>;
  };
};

type AgentResponse = {
  content: string;
  sources?: SourceLink[];
  requireLogin?: boolean;
  meta?: {
    clarify?: boolean;
    expect?: string | null;
    mode?: "anon" | "signed";
    usedSnippets?: number;
    summary?: string;
  };
};

/* ──────────────────────────────────────────────
   Domain types expected from your APIs
   (Descriptions are important per your request)
   ────────────────────────────────────────────── */
type UUID = string;

type Country = { id: UUID; name: string; description?: string | null; slug?: string | null };
type Destination = {
  id: UUID;
  country_id: UUID;
  name: string;
  description?: string | null;
  slug?: string | null;
};
type Pickup = {
  id: UUID;
  destination_id: UUID | null;
  country_id: UUID;
  name: string;
  description?: string | null;
  slug?: string | null;
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
  // SSOT: per-seat all-in price, rounded up (as per your spec)
  price_per_seat: number;
  currency: string; // "GBP" etc.
  quoteToken: string; // carry through the flow
};

type QuoteResponse = {
  items: QuoteItem[];
  // optional more fields (rates, breakdowns)
};

/* ──────────────────────────────────────────────
   Config: API endpoints (adjust if your paths differ)
   ────────────────────────────────────────────── */
const API = {
  countries: "/api/countries",
  destinations: "/api/destinations", // supports ?country_id=
  pickups: "/api/pickups",           // supports ?country_id=&destination_id=
  quote: "/api/quote",               // SSOT
};

/* ──────────────────────────────────────────────
   Minimal in-component cache to avoid re-fetching
   ────────────────────────────────────────────── */
type Catalog = {
  countries: Country[];
  destinations: Destination[]; // all; we’ll filter client-side
  pickups: Pickup[];           // all; we’ll filter client-side
};
const emptyCatalog: Catalog = { countries: [], destinations: [], pickups: [] };

/* ──────────────────────────────────────────────
   NLU helpers (no external deps)
   ────────────────────────────────────────────── */
type ParsedEntities = {
  intent?: "journeys" | "ask_countries" | "ask_destinations" | "ask_pickups" | "unknown";
  countryName?: string;
  destinationName?: string;
  pickupName?: string;
  dateISO?: string; // yyyy-mm-dd
};

function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s\-&]/gu, " ").replace(/\s+/g, " ").trim();
}

function parseDateToISO(input: string): string | undefined {
  // Try ISO yyyy-mm-dd first
  const iso = input.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) return iso[0];

  // Try UK dd/mm/yyyy or dd/mm/yy
  const uk = input.match(/\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(\d{2}|\d{4})\b/);
  if (uk) {
    const dd = parseInt(uk[1], 10);
    const mm = parseInt(uk[2], 10);
    let yyyy = uk[3].length === 2 ? 2000 + parseInt(uk[3], 10) : parseInt(uk[3], 10);
    // basic validity
    if (yyyy >= 2000 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const mmStr = mm.toString().padStart(2, "0");
      const ddStr = dd.toString().padStart(2, "0");
      return `${yyyy}-${mmStr}-${ddStr}`;
    }
  }
  return undefined;
}

function detectIntent(raw: string): ParsedEntities {
  const text = normalize(raw);

  // Direct “what countries” style
  if (/\b(what|which)\b.*\bcountries?\b/.test(text)) {
    return { intent: "ask_countries" };
  }
  if (/\b(destinations?|stops?)\b/.test(text) && /\bin\b/.test(text)) {
    // “What destinations do you visit in Antigua?”
    // leave countryName extraction to entity pass
    return { intent: "ask_destinations" };
  }
  if (/\b(pickups?|pickup points?)\b/.test(text)) {
    return { intent: "ask_pickups" };
  }

  // Journey-ish verbs
  if (
    /\b(show|find|list|any|anything|available|journeys?|routes?)\b/.test(text) ||
    /\bbook\b/.test(text)
  ) {
    return { intent: "journeys" };
  }

  return { intent: "unknown" };
}

/* Extract surface strings; entity resolution to catalog happens later */
function extractSurfaceEntities(raw: string): Omit<ParsedEntities, "intent"> {
  const dateISO = parseDateToISO(raw) ?? undefined;

  // a naive “in X” / “to X” grab for country/destination/pickup surface names
  // We’ll resolve these against the catalog with fuzzy-ish matching
  const inMatch = raw.match(/\b(?:in|to)\s+([A-Za-z][A-Za-z\s&\-']{1,60})/i);
  const surface = inMatch?.[1]?.trim();

  // Also try “in Antigua on …” where “on …” would terminate the name
  let surfaceTrimmed = surface?.replace(/\s+on\s+.*$/i, "").trim();

  return {
    countryName: surfaceTrimmed,      // might be country OR destination — we’ll resolve
    destinationName: undefined,
    pickupName: undefined,
    dateISO,
  };
}

/* ──────────────────────────────────────────────
   Resolution helpers (catalog-aware, tolerant)
   ────────────────────────────────────────────── */
function bestNameMatch<T extends { name: string }>(name: string, items: T[]): T | undefined {
  const n = normalize(name);
  let exact = items.find((i) => normalize(i.name) === n);
  if (exact) return exact;

  // startsWith or contains as a soft match
  let starts = items.find((i) => normalize(i.name).startsWith(n));
  if (starts) return starts;

  return items.find((i) => normalize(i.name).includes(n));
}

function resolveEntitiesToIds(
  parsed: ParsedEntities,
  catalog: Catalog,
  ctx: ConversationContext
): {
  country?: Country;
  destination?: Destination;
  pickup?: Pickup;
  dateISO?: string;
} {
  let country: Country | undefined;
  let destination: Destination | undefined;
  let pickup: Pickup | undefined;

  // Prefer freshly parsed date; otherwise reuse context
  const dateISO = parsed.dateISO ?? ctx.dateISO ?? undefined;

  // Try to resolve ambiguous "in X" surface against country first
  if (parsed.countryName) {
    country = bestNameMatch(parsed.countryName, catalog.countries);
    // If not a country, try destination under any country
    if (!country) {
      destination = bestNameMatch(parsed.countryName, catalog.destinations);
      if (destination) {
        country = catalog.countries.find((c) => c.id === destination!.country_id);
      }
    }
  }

  // If we still don’t have a country, reuse from context
  if (!country && ctx.country) country = ctx.country;
  if (!destination && ctx.destination) destination = ctx.destination;
  if (!pickup && ctx.pickup) pickup = ctx.pickup;

  return { country, destination, pickup, dateISO };
}

/* ──────────────────────────────────────────────
   Conversation context (in-component memory)
   ────────────────────────────────────────────── */
type ConversationContext = {
  country?: Country;
  destination?: Destination;
  pickup?: Pickup;
  dateISO?: string;
};

/* ──────────────────────────────────────────────
   Fetch helpers
   ────────────────────────────────────────────── */
async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

async function fetchCatalog(): Promise<Catalog> {
  const [countriesRes, destinationsRes, pickupsRes] = await Promise.allSettled([
    fetch(API.countries, { cache: "no-store" }),
    fetch(API.destinations, { cache: "no-store" }),
    fetch(API.pickups, { cache: "no-store" }),
  ]);

  const countries =
    countriesRes.status === "fulfilled" ? await safeJson<Country[]>(countriesRes.value) : [];
  const destinations =
    destinationsRes.status === "fulfilled" ? await safeJson<Destination[]>(destinationsRes.value) : [];
  const pickups =
    pickupsRes.status === "fulfilled" ? await safeJson<Pickup[]>(pickupsRes.value) : [];

  return { countries, destinations, pickups };
}

async function fetchDestinationsForCountry(countryId: UUID): Promise<Destination[]> {
  const res = await fetch(`${API.destinations}?country_id=${encodeURIComponent(countryId)}`, {
    cache: "no-store",
  });
  return safeJson<Destination[]>(res);
}

async function fetchPickups(params: { country_id?: UUID; destination_id?: UUID }): Promise<Pickup[]> {
  const qs = new URLSearchParams();
  if (params.country_id) qs.set("country_id", params.country_id);
  if (params.destination_id) qs.set("destination_id", params.destination_id);
  const res = await fetch(`${API.pickups}?${qs.toString()}`, { cache: "no-store" });
  return safeJson<Pickup[]>(res);
}

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
   UI Component
   ────────────────────────────────────────────── */
export default function AgentChat() {
  const [messages, setMessages] = React.useState<ChatMsg[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help with countries, destinations, pickup points, and journeys.\nTry: “Show journeys in Antigua on 2025-11-20”.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [catalog, setCatalog] = React.useState<Catalog>(emptyCatalog);
  const [ctx, setCtx] = React.useState<ConversationContext>({});

  // Load catalog once
  React.useEffect(() => {
    let alive = true;
    fetchCatalog()
      .then((cat) => alive && setCatalog(cat))
      .catch((err) => {
        console.error("Catalog fetch error:", err);
        // Keep empty catalog but don’t crash
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

    // 1) Parse + extract entities
    const intentGuess = detectIntent(raw);
    const surfaces = extractSurfaceEntities(raw);
    const parsed: ParsedEntities = { ...intentGuess, ...surfaces };

    // 2) Resolve to catalog + context
    const resolved = resolveEntitiesToIds(parsed, catalog, ctx);

    // 3) Route by intent (with smart fallbacks)
    try {
      switch (parsed.intent) {
        case "ask_countries": {
          if (!catalog.countries.length) {
            assistantSay("I couldn’t load countries just now. Please try again shortly.");
            return;
          }
          const list = catalog.countries.map((c) => `• ${c.name}`).join("\n");
          assistantSay(`We currently operate in:\n${list}`);
          return;
        }

        case "ask_destinations": {
          const country = resolved.country;
          if (!country) {
            assistantSay(
              `Which country are you interested in?\nFor example: “What destinations do you visit in Antigua?”`
            );
            return;
          }
          const dests = await fetchDestinationsForCountry(country.id).catch(() => []);
          if (!dests.length) {
            assistantSay(`I couldn’t find destinations in ${country.name} right now.`);
            return;
          }
          // Include descriptions per your requirement
          const lines = dests.map((d) => {
            const desc = d.description ? ` — ${d.description}` : "";
            return `• ${d.name}${desc}`;
          });
          assistantSay(`Destinations in ${country.name}:\n${lines.join("\n")}`);

          // Update context
          setCtx((prev) => ({ ...prev, country }));
          return;
        }

        case "ask_pickups": {
          // Prefer destination>country if we have them; else ask
          const country = resolved.country;
          const destination = resolved.destination;

          if (!country && !destination) {
            assistantSay(
              `Would you like pickups for a country or a specific destination?\nExample: “Show pickup points in Antigua” or “Pickups for English Harbour”.`
            );
            return;
          }

          const pickups = await fetchPickups({
            country_id: destination ? undefined : country?.id,
            destination_id: destination?.id,
          }).catch(() => []);

          if (!pickups.length) {
            const scope = destination ? destination.name : country?.name || "that area";
            assistantSay(`I couldn’t find pickup points for ${scope}.`);
            return;
          }

          const lines = pickups.map((p) => {
            const desc = p.description ? ` — ${p.description}` : "";
            return `• ${p.name}${desc}`;
          });
          const scope = destination ? ` for ${destination.name}` : ` in ${country?.name}`;
          assistantSay(`Pickup points${scope}:\n${lines.join("\n")}`);

          // Update context
          setCtx((prev) => ({ ...prev, country: country ?? prev.country, destination: destination ?? prev.destination }));
          return;
        }

        case "journeys": {
          // Need country or destination, and ideally date
          const { country, destination, pickup, dateISO } = resolved;

          if (!country && !destination) {
            assistantSay(
              `Tell me a country or destination to search journeys.\nFor example: “Show journeys in Antigua on 2025-11-20”.`,
              { entities: parsed }
            );
            return;
          }

          // If no date, try to continue with context — else ask
          if (!dateISO) {
            assistantSay(
              `Got it — ${destination ? destination.name : country?.name}. Which date?\n(e.g., 20/11/2025 or 2025-11-20)`
            );
            // update context with the location we do have
            setCtx((prev) => ({
              ...prev,
              country: country ?? prev.country,
              destination: destination ?? prev.destination,
              pickup: pickup ?? prev.pickup,
            }));
            return;
          }

          // Call SSOT for quotes
          const req: QuoteRequest = {
            date: dateISO,
            country_id: destination ? undefined : country?.id ?? null,
            destination_id: destination?.id ?? null,
            pickup_id: pickup?.id ?? null,
          };

          assistantSay(
            `Searching journeys for ${destination ? destination.name : country?.name} on ${dateISO}…`
          );

          const quotes = await fetchQuotes(req).catch((err) => {
            console.error("quote error", err);
            return null;
          });

          if (!quotes || !quotes.items?.length) {
            assistantSay(`No journeys found for ${destination ? destination.name : country?.name} on ${dateISO}. Try another date.`);
            // still store context
            setCtx((prev) => ({ ...prev, country, destination, pickup, dateISO }));
            return;
          }

          const top = quotes.items.slice(0, 6).map(summarizeQuoteItem).join("\n\n");
          assistantSay(
            `Here are available journeys on ${dateISO}:\n\n${top}\n\n(Prices are per seat, incl. tax & fees — SSOT)`,
            { summary: "SSOT quotes", entities: { ...parsed, dateISO } }
          );

          // Update context (success path)
          setCtx({ country, destination, pickup, dateISO });
          return;
        }

        case "unknown":
        default: {
          // If user gave only a date (e.g., “anything on 12/11/25”) and we have a remembered country/destination
          const onlyDate = parsed.dateISO && !parsed.countryName;
          if (onlyDate && (ctx.country || ctx.destination)) {
            // Re-run as journeys with inferred location
            const reParsed: ParsedEntities = { ...parsed, intent: "journeys" };
            const reResolved = resolveEntitiesToIds(reParsed, catalog, ctx);
            // recurse by faking a journeys path
            const faux = `show journeys ${
              reResolved.destination?.name
                ? `in ${reResolved.destination.name}`
                : reResolved.country?.name
                ? `in ${reResolved.country.name}`
                : ""
            } on ${reResolved.dateISO}`;
            await handleUserTurn(faux);
            return;
          }

          // Soft guidance tailored to current context
          let hint = "I can help with countries, destinations, pickup points, and journeys.";
          if (ctx.country && !ctx.dateISO) {
            hint = `You can ask: “Show journeys in ${ctx.country.name} on 2025-11-20”.`;
          } else if (!ctx.country && catalog.countries.length) {
            const sample = catalog.countries[0]?.name ?? "Antigua";
            hint = `Try: “What destinations do you visit in ${sample}?” or “Show journeys in ${sample} on 2025-11-20”.`;
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
            <div
              key={m.id}
              className={m.role === "user" ? "text-right" : "text-left"}
            >
              <div
                className={
                  m.role === "user"
                    ? "inline-block rounded-xl px-3 py-2 bg-black text-white"
                    : "inline-block rounded-xl px-3 py-2 bg-gray-100"
                }
              >
                <pre className="whitespace-pre-wrap break-words font-sans text-sm">
                  {m.content}
                </pre>
              </div>
              {m.meta?.entities ? (
                <div className="text-xs text-gray-400 mt-1">
                  {/* lightweight debug breadcrumb; remove in prod */}
                  inferred:{" "}
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
            placeholder="Ask about countries, destinations, pickup points, or say: Show journeys in Antigua on 2025-11-20"
            className="flex-1 border rounded-xl px-3 py-2 outline-none"
          />
          <button
            type="submit"
            className="rounded-xl px-4 py-2 bg-black text-white"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
