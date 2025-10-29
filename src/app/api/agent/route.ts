// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { chatComplete } from "@/lib/ai";
import { preflightGate, systemGuardrails } from "@/lib/guardrails";
import { retrieveSimilar } from "@/lib/rag";

export const runtime = "nodejs";

/* ──────────────────────────────────────────────────────────────
   0) Policy: how the agent should think + key business truths
   ────────────────────────────────────────────────────────────── */
const PACE_PUBLIC_POLICY = `
Pace Shuttles public data tools

- Use these endpoints for facts. They return clean data (no UUIDs in payloads):
  • Countries: /api/public/countries  (includes charity_name, charity_url, charity_description)
  • Destinations: /api/public/destinations  (filter with country_id if provided; else use q=)
  • Pickups: /api/public/pickups  (includes directions_url)
  • Journeys: /api/public/journeys  (prefer date=YYYY-MM-DD; you may also send date_from/date_to for ranges)
  • Vehicle Types: /api/public/vehicle-types

- Coverage precedence: if a document (RAG) disagrees with the APIs about where/when we operate,
  treat the APIs as the source of truth and say so briefly.

- Revenue model: Operators receive ride revenue; destinations do NOT. Pace Shuttles earns a commission from operators.

- Environmental note: Pace Shuttles contributes to environmental charities in the regions it operates.
  For country specifics, read charity fields from /api/public/countries.

- Do not invent data. If a field is missing say “not published yet.”
- Prefer small result sets (limit ≤ 20). For “today/this week/month” questions, call /api/public/journeys with an explicit date (or date range).
- “What do you have in <country>?” → list pickups + destinations (names + directions links); then suggest journeys for a date.
- Never contradict yourself across turns. If new data changes an answer, acknowledge and correct.
`;

/* ──────────────────────────────────────────────────────────────
   1) Session + URL helpers
   ────────────────────────────────────────────────────────────── */
async function isSignedInFromCookies(): Promise<boolean> {
  try {
    const cookieStore = cookies();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const sb = createServerClient(url, anon, {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {}, remove() {},
      },
    });
    const { data } = await sb.auth.getUser();
    return !!data?.user;
  } catch { return false; }
}

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? process.env.VERCEL_URL ?? "localhost:3000";
  return `${proto}://${host}`;
}

/* ──────────────────────────────────────────────────────────────
   2) Intent + concierge helpers
   ────────────────────────────────────────────────────────────── */
type Intent = {
  wantsQuote: boolean;
  wantsRouteInfo: boolean;
  wantsMyStuff: boolean;
  wantsCancel: boolean;

  wantsCountryList: boolean;
  wantsDestinations: boolean;
  wantsRegionsNext: boolean;
  wantsOperateInCountry: boolean;
  wantsTransportTypes: boolean;
  wantsCharities: boolean;
  wantsRoutesOverview: boolean;
};

function detectIntent(q: string): Intent {
  const s = q.toLowerCase();

  const wantsCountryList =
    /(which|what)\s+countries\b|countries\s+(do you|d’you)?\s*(operate|serve)|\boperate in which countries\b/.test(s);

  const wantsDestinations =
    /\b(what|which)\s+(destinations|places)\b|\bdestinations?\s+do (you|u)\s+(visit|serve|go)\b/.test(s);

  const wantsRegionsNext =
    /\b(what|which)\s+regions\b.*(next|future|road\s*map|roadmap)|\bwhere.*(next|future)\b/.test(s);

  const wantsOperateInCountry =
    /\bdo (you|u)\s+operate\s+in\b|\boperate in\s+[a-z]/.test(s);

  const wantsTransportTypes =
    /\b(what|which)\s+(modes|mode|transport|vehicle types?|boats?|helicopters?)\b|\btransport[-\s]?types?\b/.test(s);

  const wantsCharities =
    /\b(what|which)\s+charit(y|ies)\b|\bcharit(y|ies)\s+do (you|u)\s+(support|donate)\b/.test(s);

  const wantsRoutesOverview =
    /\b(tell me about|what about)\s+(your )?routes\b|\broutes?\s+overview\b/.test(s);

  return {
    wantsQuote: /price|cost|how much|quote|per\s*seat|ticket/i.test(s),
    wantsRouteInfo: /route|pickup|destination|depart|when|schedule|how long|duration|\bjourney\b|\bjourneys\b/i.test(s),
    wantsMyStuff: /my\s+(booking|tickets?|balance|payment|refund)|booking\s*ref/i.test(s),
    wantsCancel: /\bcancel(l|)\b|\brefund\b|\bresched/i.test(s),

    wantsCountryList,
    wantsDestinations,
    wantsRegionsNext,
    wantsOperateInCountry,
    wantsTransportTypes,
    wantsCharities,
    wantsRoutesOverview,
  };
}

function guessCountryName(q: string): string | null {
  // crude heuristic: capture words after "in/for/at"
  const m = q.match(/\b(?:in|for|at)\s+([A-Z][A-Za-z &'-]+)(?:\?|$|\.|,)/);
  return m ? m[1].trim() : null;
}

function askedForRoadmap(q: string): boolean {
  return /\b(road\s*map|roadmap|future|next)\b/i.test(q);
}

type Clarify = { text: string; expect: keyof Intent } | null;

function buildClarifyingQuestion(intent: Intent, q: string): Clarify {
  if (intent.wantsCountryList && !askedForRoadmap(q)) {
    return { text: "Do you want **countries we operate in today**, or our **future roadmap**?", expect: "wantsCountryList" };
  }
  if (intent.wantsDestinations) {
    return { text: "Would you like **all destinations**, or destinations in a **particular country or region**?", expect: "wantsDestinations" };
  }
  if (intent.wantsOperateInCountry && !guessCountryName(q)) {
    return { text: "Which **country** did you have in mind?", expect: "wantsOperateInCountry" };
  }
  if (intent.wantsRoutesOverview || intent.wantsRouteInfo) {
    return { text: "I can check live availability. Which **country** and **date**?", expect: "wantsRouteInfo" };
  }
  if (intent.wantsCharities) {
    return { text: "Would you like **all charities by country**, or the charity for a **specific country**?", expect: "wantsCharities" };
  }
  return null;
}

function findISOInText(text: string): string | null {
  const m = String(text).match(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/);
  return m ? m[0] : null;
}

/* Month name → date range (current or upcoming year) */
function parseMonthRange(text: string): { start: string; end: string } | null {
  const months = [
    "january","february","march","april","may","june",
    "july","august","september","october","november","december"
  ];
  const s = text.toLowerCase();
  const idx = months.findIndex(m => new RegExp(`\\b${m}\\b`).test(s));
  if (idx === -1) return null;

  const now = new Date();
  const year = (idx >= now.getMonth()) ? now.getFullYear() : now.getFullYear() + 1;
  const start = new Date(Date.UTC(year, idx, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, idx + 1, 0, 23, 59, 59));
  const pad = (n: number) => String(n).padStart(2, "0");
  const startISO = `${year}-${pad(idx+1)}-01`;
  const endISO = `${year}-${pad(idx+1)}-${pad(end.getUTCDate())}`;
  return { start: startISO, end: endISO };
}

function extractCutoffsFromSnippet(snippet: string) {
  const t = (snippet || "").toLowerCase();
  const has72 = /72\s*hour|72\s*hrs|3\+?\s*days/.test(t);
  const has24 = /24\s*hour|24\s*hrs|1\s*day/.test(t);
  return { cutoffFullRefundH: has72 ? 72 : 72, cutoffHalfRefundH: has24 ? 24 : 24 };
}
type RefundBand = "FULL_MINUS_FEES" | "FIFTY_PERCENT" | "NO_REFUND";
function evaluateRefundBand(departureISO: string, now = new Date(), cut = { cutoffFullRefundH:72, cutoffHalfRefundH:24 }) {
  const dep = new Date(departureISO);
  const ms = dep.getTime() - now.getTime();
  const totalHours = Math.ceil(ms / (1000 * 60 * 60));
  let band: RefundBand;
  if (totalHours >= cut.cutoffFullRefundH) band = "FULL_MINUS_FEES";
  else if (totalHours >= cut.cutoffHalfRefundH) band = "FIFTY_PERCENT";
  else band = "NO_REFUND";
  return { band, totalHours, departureLocal: dep.toLocaleString() };
}
function friendlyBand(band: RefundBand) {
  return band === "FULL_MINUS_FEES"
    ? "a full refund minus any bank fees charged to Pace Shuttles"
    : band === "FIFTY_PERCENT"
    ? "a 50% refund of the booking value"
    : "no refund (no-shows or late arrivals are treated as travelled)";
}

/* ──────────────────────────────────────────────────────────────
   3) Public data fetchers (your new endpoints)
   ────────────────────────────────────────────────────────────── */
async function fetchJson<T>(path: string, params: Record<string, any> = {}, max = 20): Promise<T[]> {
  const base = getBaseUrl();
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  if (!usp.has("limit")) usp.set("limit", String(max));
  const url = `${base}${path}${usp.toString() ? `?${usp.toString()}` : ""}`;
  const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({ rows: [] }));
  return (json?.rows ?? []) as T[];
}

type CountryRow = {
  name: string; description?: string; charity_name?: string; charity_url?: string; charity_description?: string; active?: boolean;
};
type DestinationRow = { name: string; country_name?: string; town?: string; region?: string; website_url?: string; directions_url?: string; description?: string; active?: boolean; };
type PickupRow = { name: string; country_name?: string; town?: string; region?: string; directions_url?: string; description?: string; active?: boolean; };
type JourneyRow = {
  pickup_name: string; destination_name: string; country_name: string; route_name?: string;
  starts_at: string; departure_time: string; duration_min: number; currency: string; price_per_seat_from: number; active: boolean;
};

async function pullPublicDataForQuestion(q: string, intent: Intent) {
  const iso = findISOInText(q);
  const monthRange = parseMonthRange(q); // NEW: “in November”
  const countryHint = guessCountryName(q);
  const roadmap = askedForRoadmap(q);
  const wantsAll = /\ball (countries|places|destinations)\b/i.test(q);

  // Countries: list active now vs roadmap (inactive)
  const countriesParams = intent.wantsCountryList
    ? { active: !roadmap }           // true => current; false => roadmap
    : { q, active: true };

  // Destinations: global unless they asked for a country or said “all countries”
  const destinationsParams = (countryHint || wantsAll)
    ? { q: countryHint ?? "", active: true }
    : { q, active: true };

  // Journeys: accept single date or a month range
  const journeyParams: Record<string, any> = { q: countryHint ?? q, active: true };
  if (iso) journeyParams.date = iso;
  if (monthRange) {
    journeyParams.date_from = monthRange.start;
    journeyParams.date_to = monthRange.end;
  }

  const [countries, destinations, pickups, journeys, vehicleTypes] = await Promise.all([
    fetchJson<CountryRow>("/api/public/countries", countriesParams),
    fetchJson<DestinationRow>("/api/public/destinations", destinationsParams),
    fetchJson<PickupRow>("/api/public/pickups", { q: countryHint ?? q, active: true }),
    fetchJson<JourneyRow>("/api/public/journeys", journeyParams),
    fetchJson<{ name: string; description?: string; slug?: string }>("/api/public/vehicle-types", { active: true }),
  ]);

  const blocks: string[] = [];

  // Countries (explicit ask)
  if (intent.wantsCountryList && countries.length) {
    const lines = countries.map(c =>
      `• ${c.name}${c.charity_name ? ` — charity: ${c.charity_name}` : ""}${c.charity_url ? ` (${c.charity_url})` : ""}`
    );
    blocks.push(`${roadmap ? "COUNTRIES (roadmap)" : "COUNTRIES (current)"}\n${lines.join("\n")}`);
  } else if (!intent.wantsCountryList && countries.length) {
    // soft sample to ground the model without spamming
    const lines = countries.slice(0, 6).map(c => `• ${c.name}`);
    blocks.push(`COUNTRIES (sample)\n${lines.join("\n")}`);
  }

  // Destinations (explicit ask)
  if (intent.wantsDestinations && destinations.length) {
    const lines = destinations.slice(0, 20).map(d =>
      `• ${d.name}${d.country_name ? ` — ${d.country_name}` : ""}${d.town ? `, ${d.town}` : ""}${d.directions_url ? ` (directions: ${d.directions_url})` : ""}`
    );
    blocks.push(`DESTINATIONS\n${lines.join("\n")}`);
  }

  // Transport types (explicit ask)
  if (intent.wantsTransportTypes && vehicleTypes.length) {
    const lines = vehicleTypes.map(v => `• ${v.name}${v.description ? ` — ${v.description}` : ""}`);
    blocks.push(`TRANSPORT TYPES\n${lines.join("\n")}`);
  }

  // Charities (explicit ask)
  if (intent.wantsCharities && countries.length) {
    const lines = countries
      .filter(c => c.charity_name)
      .map(c => `• ${c.name}: ${c.charity_name}${c.charity_url ? ` (${c.charity_url})` : ""}`);
    if (lines.length) blocks.push(`CHARITIES BY COUNTRY\n${lines.join("\n")}`);
  }

  // Journeys (explicit ask or overview)
  if ((intent.wantsRouteInfo || intent.wantsRoutesOverview) && journeys.length) {
    const dateLabel =
      monthRange ? ` in ${new Date(monthRange.start + "T00:00:00Z").toLocaleString("en-GB", { month: "long" })}`
      : iso ? ` on ${iso}`
      : "";
    const lines = journeys.slice(0, 20).map(j =>
      `• ${j.route_name ?? `${j.pickup_name} → ${j.destination_name}`} — ${j.departure_time} UTC, ${j.duration_min} min, from ${j.price_per_seat_from.toFixed(2)} ${j.currency}`
    );
    blocks.push(`JOURNEYS${dateLabel}\n${lines.join("\n")}`);
  }

  return blocks.join("\n\n");
}

/* ──────────────────────────────────────────────────────────────
   4) Public KB search (files)
   ────────────────────────────────────────────────────────────── */
async function searchPublicFiles(q: string, k: number) {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/tools/searchPublicKB`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: q, topK: k }),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({ matches: [] }));
  return (data?.matches ?? []).map((m: any) => ({
    title: m.title, section: m.section ?? null, content: m.snippet ?? "", url: m.url ?? null,
  }));
}

/* ──────────────────────────────────────────────────────────────
   5) Main handler
   ────────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.message || body?.text || "").trim();
  if (!q) return NextResponse.json({ content: "Please enter a question." });

  const signedIn = await isSignedInFromCookies();

  // Detect from message
  let intent = detectIntent(q);

  // If the client echoes back a prior clarifier expectation, honor it
  const expected = body?.expectedIntent as keyof Intent | undefined;
  if (expected && expected in intent) {
    (intent as any)[expected] = true;
    // special case: user reply like “all countries” → still destinations, not countries
    if (expected === "wantsDestinations" && /\ball (countries|places|destinations)\b/i.test(q)) {
      intent.wantsDestinations = true;
      intent.wantsCountryList = false;
    }
  } else {
    // Heuristic if UI hasn't been wired yet:
    if (intent.wantsDestinations && /\ball (countries|places|destinations)\b/i.test(q)) {
      intent.wantsCountryList = false;
      intent.wantsDestinations = true;
    }
  }

  // Ask one targeted clarifier first (when appropriate)
  const clarify = buildClarifyingQuestion(intent, q);
  if (clarify) {
    return NextResponse.json({ content: clarify.text, meta: { clarify: true, expect: clarify.expect } });
  }

  const k = 8;
  let snippets: any[] = [];

  /* Concierge: cancellations & refunds */
  if (intent.wantsCancel) {
    const iso = findISOInText(q);
    const hasRef = /\b[A-Z0-9]{6,}\b/.test(q);

    if (hasRef && !signedIn) {
      return NextResponse.json({
        content:
          "I can help with that. To protect your privacy, please **sign in** before I open your booking. " +
          "This ensures only the traveller can view or change bookings. Once signed in, paste your booking reference here and I’ll check your options.",
        requireLogin: true,
      });
    }

    if (iso) {
      const policySnips = await searchPublicFiles("client cancellations rescheduling refunds policy Pace Shuttles", 4);
      const best = policySnips.find(s => /cancel|refund|resched/i.test(`${s.title} ${s.section} ${s.content}`)) || policySnips[0];
      const cut = extractCutoffsFromSnippet(best?.content ?? "");
      const evaln = evaluateRefundBand(iso, new Date(), cut);

      const msg = [
        `Based on the date you provided (${evaln.departureLocal}), you are **${evaln.totalHours} hours** before departure.`,
        `Under the current policy this means **${friendlyBand(evaln.band)}**.`,
        `If you’d prefer not to cancel, I can look for **alternative dates** on the same route (rescheduling within 6 months, subject to seats). Would you like me to check?`,
        best ? `\n(From: ${best.title}${best.section ? " › " + best.section : ""})` : "",
      ].join("\n\n");

      return NextResponse.json({ content: msg });
    }

    return NextResponse.json({
      content:
        "I can help with cancellations and refunds. To work out your options I’ll need your **journey date/time**. " +
        "If you prefer, share your **booking reference**—I can check it for you.\n\n" +
        "_Note: for booking lookups you’ll be asked to **sign in** so we keep your information private._",
    });
  }

  // 1) Vector RAG
  try {
    snippets = (await retrieveSimilar(q, { signedIn, k })) || [];
  } catch { snippets = []; }

  // 2) Public KB fallback
  if (!snippets || snippets.length === 0) {
    snippets = await searchPublicFiles(q, k);
  }

  // 3) Public DATA (live) from your APIs — intent-aware
  const dataBlock = await pullPublicDataForQuestion(q, intent);

  // 4) Deflect only if account-specific AND we have no public answer
  if (!signedIn && intent.wantsMyStuff && snippets.length === 0 && !dataBlock) {
    const gate = preflightGate(q, { signedIn });
    if (gate.action === "deflect" || gate.action === "deny") {
      return NextResponse.json({ content: gate.message, sources: [], meta: { signedIn, gate: gate.action } });
    }
  }

  // Build context for the model
  const contextBlock =
    [
      snippets.length > 0
        ? snippets.map((s: any, i: number) => {
            const title = s.title || s.doc_title || "Knowledge";
            const section = s.section || null;
            return `【${i + 1}】 (${title}${section ? " › " + section : ""})\n${(s.content || "").trim()}`;
          }).join("\n\n")
        : "No relevant KB snippets found.",
      dataBlock ? `\nPUBLIC DATA (live):\n${dataBlock}` : ""
    ].join("\n\n");

  const sources = snippets.map((s: any) => ({
    title: s.title || s.doc_title || "Knowledge",
    section: s.section || null,
    url: s.url || s.uri || null,
  }));

  const sys = [
    systemGuardrails({ signedIn }),
    "Tone: warm, concise, pragmatic. Lead with the answer, then a short explanation.",
    "Use brief bullets when helpful. Avoid marketing fluff.",
    signedIn
      ? "User is signed in: you may reference their own bookings/balance/tickets via approved tools only."
      : "User is anonymous: answer only from public knowledge and public data.",
    "For account-sensitive topics: ask only for the minimum detail; require login before any lookup; explain why (privacy).",
    PACE_PUBLIC_POLICY,
  ].join("\n");

  const userPrompt = [
    `User question:\n${q}`,
    ``,
    `Use the following context (KB + live data) if relevant:`,
    contextBlock,
    ``,
    `Guidelines:`,
    `- If context is weak or missing, say so briefly and ask one targeted follow-up OR offer to create a support ticket.`,
    `- Keep answers specific. Add a one-line source tag like (From: Title › Section) if you relied on a snippet.`,
    `- For prices/routes/bookings, follow SSOT rules and do not invent details.`,
  ].join("\n");

  // Model call with graceful fallback
  let content = "";
  try {
    content = await chatComplete([
      { role: "system", content: sys },
      { role: "user", content: userPrompt },
    ]);
  } catch {
    content =
      snippets.length > 0
        ? `${(snippets[0].content || "").slice(0, 600)}\n\n(From: ${snippets[0].title || "Knowledge"}${snippets[0].section ? " › " + snippets[0].section : ""})`
        : "I couldn’t reach the assistant just now, and I don’t have enough knowledge to answer. Please try again, or email hello@paceshuttles.com.";
  }

  const summary = content.slice(0, 300);

  return NextResponse.json({
    content,
    sources,
    meta: {
      mode: signedIn ? "signed" : "anon",
      usedSnippets: Math.min(snippets.length, k),
      summary,
    },
  });
}
