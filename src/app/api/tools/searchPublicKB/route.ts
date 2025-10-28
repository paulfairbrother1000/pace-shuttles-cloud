// src/app/api/tools/searchPublicKB/route.ts
export const runtime = "nodejs";              // ensure FS access in serverless
export const dynamic = "force-dynamic";       // no caching of KB lookups

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";

type Match = {
  title: string;
  section: string | null;
  snippet: string;
  url: string | null;
  score: number; // higher = better
};

/* ------------------------- file-based parsing helpers ------------------------- */

function textify(json: any): { title: string; chunks: { section: string | null; text: string }[] } {
  // paceshuttles-overview.public.md shape
  if (json?.knowledge_base_entry) {
    const title = json.knowledge_base_entry.title ?? "Knowledge";
    const sections = json.knowledge_base_entry.sections ?? {};
    const chunks = Object.entries(sections).flatMap(([sec, val]: any) => {
      const texts: string[] = [];
      if (typeof val === "string") texts.push(val);
      if (Array.isArray(val?.details)) texts.push(val.details.join(" "));
      if (Array.isArray(val?.points)) texts.push(val.points.join(" "));
      if (Array.isArray(val?.summary_points)) texts.push(val.summary_points.join(" "));
      if (typeof val?.mission === "string") texts.push(val.mission);
      if (typeof val?.environmental_commitment === "string") texts.push(val.environmental_commitment);
      if (typeof val?.safety_and_standards === "string") texts.push(val.safety_and_standards);
      if (typeof val?.commercial_model === "string") texts.push(val.commercial_model);
      if (Array.isArray(val?.guidelines)) texts.push(val.guidelines.join(" "));
      return [{ section: String(sec), text: texts.join(" ") }];
    });
    return { title, chunks };
  }

  // faqs.public.md shape
  if (Array.isArray(json?.faqs)) {
    const title = json?.title ?? "FAQs";
    const chunks = json.faqs.map((f: any) => ({
      section: f.question ?? null,
      text: [f.question, f.answer].filter(Boolean).join(" "),
    }));
    return { title, chunks };
  }

  // client-terms.public.md shape
  if (Array.isArray(json?.sections)) {
    const title = json?.title ?? "Terms";
    const chunks = json.sections.flatMap((s: any) => {
      const texts: string[] = [];
      if (Array.isArray(s.content)) {
        for (const c of s.content) {
          if (c?.text) texts.push(c.text);
          if (Array.isArray(c?.items)) texts.push(c.items.join(" "));
        }
      }
      if (Array.isArray(s.subsections)) {
        for (const sub of s.subsections) {
          if (Array.isArray(sub.content)) {
            for (const c of sub.content) {
              if (c?.text) texts.push(c.text);
              if (Array.isArray(c?.items)) texts.push(c.items.join(" "));
            }
          }
        }
      }
      return [{ section: s.title ?? null, text: texts.join(" ") }];
    });
    return { title, chunks };
  }

  // fallback: stringify JSON
  return { title: "Knowledge", chunks: [{ section: null, text: JSON.stringify(json) }] };
}

function score(query: string, text: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  let s = 0;
  for (const term of q) {
    // FIX: proper template string + escaping
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const m = t.match(re);
    s += m ? m.length : 0;
  }
  // length-normalised so huge sections don’t dominate
  return s > 0 ? s / Math.sqrt(Math.max(100, text.length)) : 0;
}

async function findMatchesFromFiles(query: string, topK = 8): Promise<Match[]> {
  const kbDir = path.join(process.cwd(), "public", "knowledge");
  const files = await fs.readdir(kbDir).catch(() => []);
  const candidates = files.filter((f) => f.endsWith(".public.md"));

  const matches: Match[] = [];

  for (const file of candidates) {
    const raw = await fs.readFile(path.join(kbDir, file), "utf8").catch(() => "");
    if (!raw) continue;

    // files are JSON stored with .md extension
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }

    const { title, chunks } = textify(json);
    for (const ch of chunks) {
      const sc = score(query, ch.text);
      if (sc > 0) {
        matches.push({
          title,
          section: ch.section,
          snippet: ch.text.slice(0, 600),
          url: null,
          score: sc,
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topK);
}

/* ---------------------------- vector search (DB) ---------------------------- */

async function findMatchesFromDB(query: string, topK = 8): Promise<Match[]> {
  // Build absolute base URL for /api/ai/embed call
  const base = process.env.NEXT_PUBLIC_BASE_URL
    ? process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")
    : "";

  // 1) get embedding for the query
  let qvec: number[] | null = null;
  try {
    const res = await fetch(`${base}/api/ai/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [query] }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const { embeddings } = await res.json();
    qvec = embeddings?.[0] ?? null;
  } catch {
    qvec = null;
  }
  if (!qvec) return [];

  // 2) call your kb_public_search RPC (anon read-enabled by your policies)
  try {
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get() {}, set() {}, remove() {} } }
    );

    const { data, error } = await sb.rpc("kb_public_search", {
      query_embedding: qvec as any,
      match_count: topK,
    });

    if (error || !Array.isArray(data)) return [];
    const matches: Match[] = data.map((r: any) => ({
      title: r.doc_title ?? "Knowledge",
      section: r.section ?? null,
      snippet: (r.content ?? "").slice(0, 600),
      url: r.url ?? null,
      score: typeof r.similarity === "number" ? r.similarity : 0,
    }));
    // Sort by score desc just in case
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, topK);
  } catch {
    return [];
  }
}

/* --------------------------------- ROUTES ---------------------------------- */

// GET: handy for manual testing in the browser
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (!q) {
    return NextResponse.json({
      ok: true,
      hint:
        "POST { query } to this endpoint, or GET with ?q=your+question for a quick check.",
      example: "/api/tools/searchPublicKB?q=cancellation",
    });
  }

  // Try DB vector search first; fall back to file search
  const db = await findMatchesFromDB(q, 8);
  if (db.length > 0) return NextResponse.json({ matches: db });

  const fsMatches = await findMatchesFromFiles(q, 8);
  return NextResponse.json({ matches: fsMatches });
}

// POST: used by /api/agent
export async function POST(req: Request) {
  try {
    const { query, topK = 8 } = await req.json();
    if (!query) return NextResponse.json({ matches: [] });

    const db = await findMatchesFromDB(String(query), Number(topK));
    if (db.length > 0) return NextResponse.json({ matches: db });

    const fsMatches = await findMatchesFromFiles(String(query), Number(topK));
    return NextResponse.json({ matches: fsMatches });
  } catch (e: any) {
    return NextResponse.json(
      { matches: [], error: e?.message ?? "Search error" },
      { status: 500 }
    );
  }
}
