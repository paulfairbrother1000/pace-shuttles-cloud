// src/app/api/admin/kb/ingest/route.ts
// Run by visiting /api/admin/kb/ingest (GET) or POSTing to it.
// Requires your knowledge files under /public/knowledge/*
// Embedding model must return 1536-dim vectors (matches table schema).

import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs"; // we need fs

type Chunk = { section: string | null; content: string };

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
  const kbRoot = path.join(process.cwd(), "public", "knowledge");
  await fs.access(kbRoot).catch(() => {
    throw new Error("Folder public/knowledge not found");
  });

  // Use anon server client (works if RLS allows insert). If not, swap to your supabaseService().
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get() {}, set() {}, remove() {} } }
  );

  // Ensure default source
  let sourceId: string | null = null;
  {
    const { data } = await sb.from("kb_sources").select("id").eq("name", "Default Source").maybeSingle();
    if (data?.id) sourceId = data.id;
    else {
      const ins = await sb.from("kb_sources")
        .insert({ name: "Default Source", audience: "public" })
        .select("id").single();
      sourceId = ins.data?.id ?? null;
    }
  }
  if (!sourceId) throw new Error("Could not create/find kb_sources row");

  const files = (await walk(kbRoot)).filter(f => /\.(md|markdown|txt)$/i.test(f));

  let docs = 0, chunks = 0;

  // helper to embed with internal API (no NEXT_PUBLIC_BASE_URL needed)
  async function embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${baseUrl}/api/ai/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts })
    });
    if (!res.ok) throw new Error(`Embedding API failed (${res.status})`);
    const j = await res.json();
    return j.embeddings as number[][];
  }

  for (const abs of files) {
    const rel = abs.split(path.join("public", "knowledge") + path.sep)[1] ?? path.basename(abs);
    const raw = await fs.readFile(abs, "utf8");

    // Create doc (idempotence-lite: remove any previous doc by same uri to avoid dupes)
    await sb.from("kb_docs").delete().eq("uri", `/knowledge/${rel}`);

    const title = path.basename(rel).replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]/g, " ");
    const { data: docRow, error: docErr } = await sb
      .from("kb_docs")
      .insert({ source_id: sourceId, uri: `/knowledge/${rel}`, title })
      .select("id")
      .single();
    if (docErr || !docRow?.id) throw docErr ?? new Error("Failed to insert kb_docs");
    docs += 1;

    const parts = chunkText(raw, 1200);
    if (parts.length === 0) continue;

    // batch embed (keep it simple: one shot)
    const vectors = await embed(parts.map(p => p.content));
    const rows = parts.map((p, i) => ({
      doc_id: docRow.id,
      section: p.section,
      content: p.content,
      embedding: vectors[i]
    }));

    const { error: insErr } = await sb.from("kb_chunks").insert(rows);
    if (insErr) throw insErr;
    chunks += rows.length;
  }

  // (Re)build vector index — safe if it already exists
  await sb.rpc("sql", {
    // If you don't have http RPC for arbitrary SQL, skip this. Index was created in the earlier SQL.
  }).catch(() => { /* ignore */ });

  return { docs, chunks };
}

// GET lets you click the URL; POST is also supported
export async function GET(req: Request) {
  const url = new URL(req.url);
  const proto = url.protocol.replace(":", "") || "https";
  const host = url.host;
  const base = `${proto}://${host}`;
  try {
    const result = await doIngest(base);
    return NextResponse.json({ ok: true, method: "GET", ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, method: "GET", error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const proto = url.protocol.replace(":", "") || "https";
  const host = url.host;
  const base = `${proto}://${host}`;
  try {
    const result = await doIngest(base);
    return NextResponse.json({ ok: true, method: "POST", ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, method: "POST", error: e?.message ?? String(e) }, { status: 500 });
  }
}
