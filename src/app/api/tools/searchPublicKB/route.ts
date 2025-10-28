import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

type Match = {
  title: string;
  section: string | null;
  snippet: string;
  url: string | null;
  score: number;
};

function textify(json: any): { title: string; chunks: { section: string | null; text: string }[] } {
  // Handles the three shapes you shared (terms, faqs, overview)
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

  if (Array.isArray(json?.faqs)) {
    const title = json?.title ?? "FAQs";
    const chunks = json.faqs.map((f: any) => ({
      section: f.question ?? null,
      text: [f.question, f.answer].filter(Boolean).join(" "),
    }));
    return { title, chunks };
  }

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

  return { title: "Knowledge", chunks: [{ section: null, text: JSON.stringify(json) }] };
}

function score(query: string, text: string): number {
  const q = query.toLowerCase().split(/\s+/).filter(Boolean);
  const t = text.toLowerCase();
  let s = 0;
  for (const term of q) {
    const m = t.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"));
    s += m ? m.length : 0;
  }
  // length-normalised boost
  return s > 0 ? s / Math.sqrt(Math.max(100, text.length)) : 0;
}

export async function POST(req: Request) {
  try {
    const { query, topK = 8 } = await req.json();
    if (!query) return NextResponse.json({ matches: [] });

    const kbDir = path.join(process.cwd(), "public", "knowledge");
    const files = await fs.readdir(kbDir);
    const candidates = files.filter(f => f.endsWith(".public.md"));

    const matches: Match[] = [];

    for (const file of candidates) {
      const raw = await fs.readFile(path.join(kbDir, file), "utf8");
      // The files are JSON stored in .md — parse safely
      const json = JSON.parse(raw);
      const { title, chunks } = textify(json);

      for (const ch of chunks) {
        const sc = score(query, ch.text);
        if (sc > 0) {
          matches.push({
            title,
            section: ch.section,
            snippet: ch.text.slice(0, 400),
            url: null,
            score: sc,
          });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return NextResponse.json({ matches: matches.slice(0, topK) });
  } catch (e: any) {
    return NextResponse.json({ matches: [], error: e?.message ?? "Search error" }, { status: 500 });
  }
}
