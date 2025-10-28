// src/app/api/admin/kb/ingest/route.ts
// Trigger by visiting /api/admin/kb/ingest (GET) or POSTing to it.
// Reads knowledge files under /public/knowledge/** (md/markdown/txt).
// Requires your /api/ai/embed endpoint to return embeddings: number[][].

import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { supabaseService } from "@/lib/supabaseServer";

export const runtime = "nodejs"; // needs fs access

type Chunk = { section: string | null; content: string };

/** Naive Markdown chunker: splits on headings and size */
function chunkText(input: string, max = 1200): Chunk[] {
  const lines = input.split(/\r?\n/);
  const out: Chunk[] = [];
  let buf: string[] = [];
  let section: string | null = null;

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ section, content: text });
    buf = [];
  };

  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) {
      if (buf.length) flush();
      section = h[1].trim();
      continue;
    }
    buf.push(line);
    if (buf.join("\n").length >= max) flush();
  }
  flush();
  return out;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

async function doIngest(baseUrl: string) {
  // 0) locate knowledge root
  const kbRoot = path.join(process.cwd(), "public", "knowledge");
  await fs.access(kbRoot).catch(() => {
    throw new Error("Folder public/knowledge not found");
  });

  // 1) server-only Supabase (SERVICE ROLE) so inserts bypass RLS
  const sb = supabaseService();

  // 2) ensure a default source exists
  let sourceId: string | null = null;
  {
    const { data } = await sb
      .from("kb_sources")
      .select("id")
      .eq("name", "Default Source")
      .maybeSingle();
    if (data?.id) {
      sourceId = data.id as string;
    } else {
      const ins = await sb
        .from("kb_sources")
        .insert({ name: "Default Source", audience: "public" })
        .select("id")
        .single();
      sourceId = (ins.data as any)?.id ?? null;
    }
  }
  if (!sourceId) throw new Error("Could not create/find kb_sources row");

  // 3) collect files
  const files = (await walk(kbRoot)).filter((f) => /\.(md|markdown|txt)$/i.test(f));

  let docs = 0;
  let chunks = 0;

  // Helper to call your embedding API (same origin)
  async function embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${baseUrl}/api/ai/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      cache: "no-store",
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => String(res.status));
      throw new Error(`Embedding API failed: ${res.status} ${msg}`);
    }
    const j = (await res.json()) as { embeddings: number[][] };
    return j.embeddings;
  }

  for (const abs of files) {
    const rel =
      abs.split(path.join("public", "knowledge") + path.sep)[1] ??
      path.basename(abs);

    const urlPath = `/knowledge/${rel}`; // stored in kb_docs.url & kb_chunks.url
    const raw = await fs.readFile(abs, "utf8");

    // 4) idempotency: remove any prior doc with same url
    await sb.from("kb_docs").delete().eq("url", urlPath);

    // 5) insert doc row
    const title = path
      .basename(rel)
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/[-_]/g, " ");
    const { data: docRow, error: docErr } = await sb
      .from("kb_docs")
      .insert({ source_id: sourceId, url: urlPath, title })
      .select("id")
      .single();
    if (docErr || !docRow?.id) throw docErr ?? new Error("Failed to insert kb_docs");
    docs += 1;

    // 6) chunk + embed + insert chunks
    const parts = chunkText(raw, 1200);
    if (parts.length === 0) continue;

    const vectors = await embed(parts.map((p) => p.content));

    const rows = parts.map((p, i) => ({
      doc_id: docRow.id,     // bigint in your schema is fine; supabase-js will cast
      section: p.section,
      content: p.content,
      url: urlPath,          // your kb_chunks has a url column
      embedding: vectors[i], // public.vector accepts float[] from supabase-js
    }));

    const { error: insErr } = await sb.from("kb_chunks").insert(rows);
    if (insErr) throw insErr;

    chunks += rows.length;
  }

  return { docs, chunks };
}

// Convenience wrappers so you can click or POST
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  try {
    const result = await doIngest(base);
    return NextResponse.json({ ok: true, method: "GET", ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, method: "GET", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  try {
    const result = await doIngest(base);
    return NextResponse.json({ ok: true, method: "POST", ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, method: "POST", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
