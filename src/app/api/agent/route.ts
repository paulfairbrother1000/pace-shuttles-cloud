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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.message || body?.text || "").trim();
  if (!q) return NextResponse.json({ content: "Please enter a question." });

  const signedIn = await isSignedInFromCookies();
  const intent = detectIntent(q);

  const k = 8;
  let snippets: any[] = [];

  // 1) Try vector RAG (public view for anon)
  try {
    snippets = (await retrieveSimilar(q, { signedIn, k })) || [];
  } catch { snippets = []; }

  // 2) Fallback to file-based public KB
  if (!snippets || snippets.length === 0) {
    snippets = await searchPublicFiles(q, k);
  }

  // 3) Only deflect if it's clearly account-specific AND we don't have a public answer
  if (!signedIn && intent.wantsMyStuff && snippets.length === 0) {
    const gate = preflightGate(q, { signedIn });
    if (gate.action === "deflect" || gate.action === "deny") {
      return NextResponse.json({ content: gate.message, sources: [], meta: { signedIn, gate: gate.action } });
    }
  }

  // Build context
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
