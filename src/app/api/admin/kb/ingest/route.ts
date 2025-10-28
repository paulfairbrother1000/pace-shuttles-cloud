import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";

/** Simple markdown splitter */
function chunkText(input: string, max = 1000): { section: string | null; content: string }[] {
  const lines = input.split(/\r?\n/);
  const out: { section: string | null; content: string }[] = [];
  let cur: string[] = [];
  let section: string | null = null;

  const flush = () => {
    const text = cur.join("\n").trim();
    if (text) out.push({ section, content: text });
    cur = [];
  };

  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) {
      if (cur.length) flush();
      section = h[1].trim();
      continue;
    }
    cur.push(line);
    if (cur.join("\n").length > max) flush();
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

// POST /api/admin/kb/ingest
export async function POST() {
  try {
    const kbRoot = path.join(process.cwd(), "public", "knowledge");
    // ensure folder exists
    await fs.access(kbRoot);

    // RLS-aware anon client is fine for inserts if your policies allow authenticated server env;
    // otherwise flip to service role by calling your own /lib/supabaseServer supabaseService().
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get() {}, set() {}, remove() {} } }
    );

    // find/create default source
    let sourceId: string | null = null;
    {
      const { data } = await sb
        .from("kb_sources")
        .select("id")
        .eq("name", "Default Source")
        .maybeSingle();
      if (data?.id) sourceId = data.id;
      else {
        const ins = await sb
          .from("kb_sources")
          .insert({ name: "Default Source", audience: "public" })
          .select("id")
          .single();
        sourceId = ins.data?.id ?? null;
      }
    }
    if (!sourceId) return NextResponse.json({ error: "No kb_sources row" }, { status: 500 });

    // enumerate files
    const all = await walk(kbRoot);
    const textFiles = all.filter(f => /\.(md|markdown|txt)$/i.test(f));

    // helper to embed texts
    async function embed(texts: string[]): Promise<number[][]> {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/ai/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts })
      });
      if (!res.ok) throw new Error("Embedding API failed");
      const j = await res.json();
      return j.embeddings as number[][];
    }

    let docCount = 0, chunkCount = 0;

    for (const abs of textFiles) {
      const rel = abs.split(path.join("public", "knowledge") + path.sep)[1] ?? path.basename(abs);
      const raw = await fs.readFile(abs, "utf8");

      // create doc row
      const title = path.basename(rel).replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]/g, " ");
      const { data: doc } = await sb
        .from("kb_docs")
        .insert({ source_id: sourceId, uri: `/knowledge/${rel}`, title })
        .select("id")
        .single();
      const docId = doc?.id;
      if (!docId) continue;
      docCount++;

      // chunk + embed in small batches
      const chunks = chunkText(raw, 1200);
      const texts = chunks.map(c => c.content);
      const embeds = await embed(texts);
      const rows = chunks.map((c, i) => ({
        doc_id: docId,
        section: c.section,
        content: c.content,
        embedding: embeds[i]
      }));
      const { error } = await sb.from("kb_chunks").insert(rows);
      if (error) throw error;
      chunkCount += rows.length;
    }

    return NextResponse.json({ ok: true, docs: docCount, chunks: chunkCount });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
