// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { chatComplete } from "@/lib/ai";
import { preflightGate, systemGuardrails } from "@/lib/guardrails";
import { retrieveSimilar } from "@/lib/rag";

/* ──────────────────────────────────────────────────────────────
   0) Policy & constants
   ────────────────────────────────────────────────────────────── */
const PACE_PUBLIC_POLICY = `
Facts & tools (public, anon-safe):
• Countries: /api/public/countries  (includes charity_name, charity_url, charity_description; filter active=true)
• Destinations: /api/public/destinations  (q=, country filter via name)
• Pickups: /api/public/pickups          (q=, includes directions_url)
• Journeys: /api/public/journeys        (date=YYYY-MM-DD strongly preferred)
• Vehicle Types: /api/public/vehicle-types

Revenue model (must be accurate):
• Operators receive the ride revenue; destinations do NOT receive revenue.
• Pace Shuttles earns a commission from operators.

Environmental note:
• Pace Shuttles contributes to environmental charities in the regions it operates.
• Retrieve charity fields from /api/public/countries when asked.

General:
• Do not invent data. If a field is missing, say “not published yet.”
• Prefer small result sets (limit ≤ 20).
`;

/* ──────────────────────────────────────────────────────────────
   1) Session helpers
   ────────────────────────────────────────────────────────────── */
async function isSignedInFromCookies(): Promise<boolean> {
  try {
    const cookieStore = cookies();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const sb = createServerClient(url, anon, {
      cookies: { get: (n) => cookieStore.get(n)?.value, set() {}, remove() {} },
    });
    const { data } = await sb.auth.getUser();
    return !!data?.user;
  } catch {
    return false;
  }
}

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  return `${proto}://${host}`;
}

/* ──────────────────────────────────────────────────────────────
   2) Intent + helpers
   ────────────────────────────────────────────────────────────── */
function detectIntent(q: string) {
  const s = q.toLowerCase();

  const wantsCountryList =
    /(which|what)\s+countries\b|countries\s+(do you|d’you)?\s*(operate|serve)|\boperate in which countries\b/.test(s);

  const wantsRoadmapQuery =
    /\b(road\s*map|roadmap|future|next|coming|planned|expanding)\b/.test(s);

  const wantsDestinations =
    /\b(what|which)\s+(destinations|places)\b|\bdestinations?\s+do (you|u)\s+(visit|serve|go)\b/.test(s);

  const wantsTransportTypes =
    /\b(what|which)\s+(modes|mode|transport|vehicle types?|boats?|helicopters?)\b|\btransport[-\s]?types?\b/.test(s);

  const wantsCharities =
    /\b(what|which)\s+charit(y|ies)\b|\bcharit(y|ies)\s+do (you|u)\s+(support|donate)\b/.test(s);

  const wantsRoutesOverview =
    /\b(tell me about|what about)\s+(your )?routes\b|\broutes?\s+overview\b/.test(s);

  return {
    wantsQuote: /price|cost|how much|quote|per\s*seat|ticket/i.test(s),
    wantsRouteInfo:
      /route|pickup|destination|depart|when|schedule|how long|duration/i.test(s),
    wantsMyStuff:
      /my\s+(booking|tickets?|balance|payment|refund)|booking\s*ref/i.test(s),
    wantsCancel: /\bcancel(l|)\b|\brefund\b|\bresched/i.test(s),

    wantsCountryList,
    wantsRoadmapQuery, // NEW: explicit roadmap switch
    wantsDestinations,
    wantsTransportTypes,
    wantsCharities,
    wantsRoutesOverview,
  };
}

function guessCountryName(q: string): string | null {
  const m = q.match(/\b(?:in|for|at|of)\s+([A-Z][A-Za-z &'-]+)(?:\?|$|\.|,)/);
  return m ? m[1].trim() : null;
}

/* ──────────────────────────────────────────────────────────────
   3) Public data fetchers
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

function findISOInText(text: string): string | null {
  const m = String(text).match(/\b\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\b/);
  return m ? m[0] : null;
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

/* Rolling 30-day window: “operational today” if any journey exists in next 30 days */
async function getOperationalCountriesRollingWindow(): Promise<string[]> {
  const base = new Date();
  const names = new Set<string>();
  for (let offset = 0; offset <= 30; offset += 5) {
    const dt = new Date(base.getTime() + offset * 86400000);
    const iso = dt.toISOString().slice(0, 10);
    const journeys = await fetchJson<JourneyRow>("/api/public/journeys", { date: iso, active: true }, 200);
    for (const j of journeys) if (j.country_name) names.add(j.country_name);
  }
  return [...names];
}

/* Build a live data block for grounding */
async function pullPublicDataForQuestion(
  q: string,
  intent: ReturnType<typeof detectIntent>,
) {
  const iso = findISOInText(q);
  const countryHint = guessCountryName(q);

  const blocks: string[] = [];

  // Countries: NO clarifier. Default = “current” (operational). If user explicitly asked for future → roadmap.
  if (intent.wantsCountryList) {
    const opNames = await getOperationalCountriesRollingWindow();
    if (intent.wantsRoadmapQuery) {
      const allActive = await fetchJson<CountryRow>("/api/public/countries", { active: true }, 200);
      const roadmap = allActive.map(c => c.name).filter(n => !opNames.includes(n));
      blocks.push(
        roadmap.length
          ? `COUNTRIES (roadmap)\n${roadmap.map(n => `• ${n}`).join("\n")}`
          : "COUNTRIES (roadmap)\n• Not published yet."
      );
    } else {
      blocks.push(
        opNames.length
          ? `COUNTRIES (current)\n${opNames.map(n => `• ${n}`).join("\n")}`
          : "COUNTRIES (current)\n• Not published yet."
      );
    }
  }

  // Destinations: answer directly if the country is already in the question
  if (intent.wantsDestinations) {
    const destinations = await fetchJson<DestinationRow>("/api/public/destinations", countryHint ? { q: countryHint, active: true } : { q, active: true });
    if (destinations.length) {
      const lines = destinations.slice(0, 20).map(d =>
        `• ${d.name}${d.country_name ? ` — ${d.country_name}` : ""}${d.town ? `, ${d.town}` : ""}${d.directions_url ? ` (directions: ${d.directions_url})` : ""}`,
      );
      blocks.push(`DESTINATIONS${countryHint ? ` in ${countryHint}` : ""}\n${lines.join("\n")}`);
    } else if (countryHint) {
      blocks.push(`DESTINATIONS in ${countryHint}\n• Not published yet.`);
    }
  }

  if (intent.wantsTransportTypes) {
    const vehicleTypes = await fetchJson<{ name: string; description?: string; slug?: string }>("/api/public/vehicle-types", { active: true });
    if (vehicleTypes.length) {
      const lines = vehicleTypes.map(v => `• ${v.name}${v.description ? ` — ${v.description}` : ""}`);
      blocks.push(`TRANSPORT TYPES\n${lines.join("\n")}`);
    }
  }

  if (intent.wantsRouteInfo || intent.wantsRoutesOverview) {
    const journeys = await fetchJson<JourneyRow>("/api/public/journeys", { q: countryHint ?? q, date: iso ?? undefined, active: true }, 200);
    if (journeys.length) {
      const lines = journeys.slice(0, 20).map(j => {
        const priceStr = j.price_per_seat_from && j.price_per_seat_from > 0
          ? `from ${j.price_per_seat_from.toFixed(2)} ${j.currency}`
          : "price to be confirmed";
        const label = j.route_name ?? `${j.pickup_name} → ${j.destination_name}`;
        return `• ${label} — ${j.departure_time} UTC, ${j.duration_min} min, ${priceStr}`;
      });
      blocks.push(`JOURNEYS${iso ? ` on ${iso}` : ""}${countryHint ? ` in ${countryHint}` : ""}\n${lines.join("\n")}`);
    }
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
  const intent = detectIntent(q);

  /* Concierge path (unchanged) */
  if (intent.wantsCancel) {
    const iso = findISOInText(q);
    const hasRef = /\b[A-Z0-9]{6,}\b/.test(q);
    if (hasRef && !signedIn) {
      return NextResponse.json({
        content:
          "I can help with that. To protect your privacy, please **sign in** before I open your booking. Once signed in, paste your booking reference here and I’ll check your options.",
        requireLogin: true,
      });
    }
    if (iso) {
      const policySnips = await searchPublicFiles("client cancellations rescheduling refunds policy Pace Shuttles", 4);
      const best = policySnips[0];
      const cut = extractCutoffsFromSnippet(best?.content ?? "");
      const evaln = evaluateRefundBand(iso, new Date(), cut);
      const msg = [
        `Based on the date you provided (${evaln.departureLocal}), you are **${evaln.totalHours} hours** before departure.`,
        `Under the policy this means **${friendlyBand(evaln.band)}**.`,
        best ? `\n(From: ${best.title}${best.section ? " › " + best.section : ""})` : "",
      ].join("\n\n");
      return NextResponse.json({ content: msg });
    }
    return NextResponse.json({
      content:
        "I can help with cancellations and refunds. Please share your **journey date/time** (or your booking reference once you’re signed in).",
    });
  }

  // Pull live PUBLIC data first (now includes country handling without clarifier)
  const dataBlock = await pullPublicDataForQuestion(q, intent);

  // Vector RAG (KB) + fallback
  const k = 8;
  let snippets: any[] = [];
  try {
    snippets = (await retrieveSimilar(q, { signedIn, k })) || [];
  } catch {
    snippets = [];
  }
  if (!snippets || snippets.length === 0) {
    snippets = await searchPublicFiles(q, k);
  }

  // If nothing public and user asks account stuff → deflect politely
  if (!signedIn && intent.wantsMyStuff && snippets.length === 0 && !dataBlock) {
    const gate = preflightGate(q, { signedIn });
    if (gate.action === "deflect" || gate.action === "deny") {
      return NextResponse.json({
        content: gate.message,
        sources: [],
        meta: { signedIn, gate: gate.action },
      });
    }
  }

  // Build context
  const contextBlock = [
    snippets.length > 0
      ? snippets
          .map((s: any, i: number) => {
            const title = s.title || s.doc_title || "Knowledge";
            const section = s.section || null;
            return `【${i + 1}】 (${title}${section ? " › " + section : ""})\n${(s.content || "").trim()}`;
          })
          .join("\n\n")
      : "No relevant KB snippets found.",
    dataBlock ? `\nPUBLIC DATA (live):\n${dataBlock}` : "",
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
      dataBlock ||
      (snippets.length > 0
        ? `${(snippets[0].content || "").slice(0, 600)}\n\n(From: ${snippets[0].title || "Knowledge"}${snippets[0].section ? " › " + snippets[0].section : ""})`
        : "I couldn’t reach the assistant just now, and I don’t have enough knowledge to answer. Please try again, or email hello@paceshuttles.com.");
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
