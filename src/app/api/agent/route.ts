// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { chatComplete } from "@/lib/ai";
import { preflightGate, systemGuardrails } from "@/lib/guardrails";
import { retrieveSimilar } from "@/lib/rag";

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

function detectIntent(q: string) {
  const s = q.toLowerCase();
  return {
    wantsQuote: /price|cost|how much|quote|per\s*seat|ticket/i.test(s),
    wantsRouteInfo: /route|pickup|destination|depart|when|schedule|how long|duration/i.test(s),
    wantsMyStuff: /my\s+(booking|tickets?|balance|payment|refund)|booking\s*ref/i.test(s),
    wantsCancel: /\bcancel(l|)\b|\brefund\b|\bresched/i.test(s), // concierge path
  };
}

// absolute URL helper for internal fetch
async function searchPublicFiles(q: string, k: number) {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? process.env.VERCEL_URL ?? "localhost:3000";
  const base = `${proto}://${host}`;
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

/* ── Concierge helpers (keeps docs as source of truth) ── */
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.message || body?.text || "").trim();
  if (!q) return NextResponse.json({ content: "Please enter a question." });

  const signedIn = await isSignedInFromCookies();
  const intent = detectIntent(q);

  const k = 8;
  let snippets: any[] = [];

  /* ── Concierge: cancellations & refunds ── */
  if (intent.wantsCancel) {
    const iso = findISOInText(q);
    const hasRef = /\b[A-Z0-9]{6,}\b/.test(q); // simple booking-ref heuristic

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
  /* ─────────────────────────────────────── */

  // 1) Try vector RAG (public view for anon)
  try {
    snippets = (await retrieveSimilar(q, { signedIn, k })) || [];
  } catch { snippets = []; }

  // 2) Fallback to file-based public KB
  if (!snippets || snippets.length === 0) {
    snippets = await searchPublicFiles(q, k);
  }

  // 3) Deflect only if account-specific AND we have no public answer
  if (!signedIn && intent.wantsMyStuff && snippets.length === 0) {
    const gate = preflightGate(q, { signedIn });
    if (gate.action === "deflect" || gate.action === "deny") {
      return NextResponse.json({ content: gate.message, sources: [], meta: { signedIn, gate: gate.action } });
    }
  }

  // Build context for the model
  const contextBlock =
    snippets.length > 0
      ? snippets.map((s: any, i: number) => {
          const title = s.title || s.doc_title || "Knowledge";
          const section = s.section || null;
          return `【${i + 1}】 (${title}${section ? " › " + section : ""})\n${(s.content || "").trim()}`;
        }).join("\n\n")
      : "No relevant snippets found.";

  const sources = snippets.map((s: any) => ({
    title: s.title || s.doc_title || "Knowledge",
    section: s.section || null,
    url: s.url || s.uri || null,
  }));

  const sys = [
    systemGuardrails({ signedIn }),
    `Tone: warm, concise, pragmatic. Lead with the answer, then a short explanation.`,
    `Use brief bullets when helpful. Avoid marketing fluff.`,
    signedIn
      ? `User is signed in: you may reference their own bookings/balance/tickets via approved tools only.`
      : `User is anonymous: answer only from public knowledge and public data.`,
    // concierge guidance for other sensitive flows
    `For account-sensitive topics: ask only for the minimum detail; require login before any lookup; explain why (privacy).`,
  ].join("\n");

  const userPrompt = [
    `User question:\n${q}`,
    ``,
    `Use the following context snippets if relevant:`,
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
    meta: { mode: signedIn ? "signed" : "anon", usedSnippets: Math.min(snippets.length, k), summary },
  });
}
