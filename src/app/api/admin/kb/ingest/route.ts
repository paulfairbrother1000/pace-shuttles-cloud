// src/app/api/admin/kb/ingest/route.ts
// Trigger by visiting /api/admin/kb/ingest (GET) or POSTing to it.
// Reads JSON-in-.md files and PDFs under /public/knowledge/** (md/markdown/txt/pdf).
// Calls OpenAI embeddings via src/lib/ai.ts (embedDirect).
// Matches your schema: kb_docs(url, doc_key, source_id, title), kb_chunks(url, ...).

import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { supabaseService } from "@/lib/supabaseServer";
import { embed as embedDirect } from "@/lib/ai";

export const runtime = "nodejs"; // needs fs

type Chunk = { section: string | null; content: string };

/** Naive Markdown/JSON chunker: splits on headings and size */
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

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

// --- PDF text extraction (Node-safe via pdf-parse v1.1.1) ---
async function extractPdfText(absPath: string): Promise<string> {
  // pdf-parse@1.1.1 exposes a CJS default export; dynamic import works in Node.
  const { default: pdfParse } = await import("pdf-parse");
  const buf = await fs.readFile(absPath);
  const result = await pdfParse(buf);
  // Normalize whitespace to help scoring & chunking
  return String(result.text || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

// Use your OpenAI helper directly
async function embed(texts: string[]): Promise<number[][]> {
  return await embedDirect(texts);
}

async function doIngest(_baseUrl: string) {
  // 0) locate knowledge root
  const kbRoot = path.join(process.cwd(), "public", "knowledge");
  await fs.access(kbRoot).catch(() => {
    throw new Error("Folder public/knowledge not found");
  });

  // 1) server-only Supabase (SERVICE ROLE) so inserts bypass RLS
  const sb = supabaseService();

  // 2) ensure a default source exists (uuid id)
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

  // 3) collect files (md/markdown/txt/pdf)
  const files = (await walk(kbRoot)).filter((f) =>
    /\.(md|markdown|txt|pdf)$/i.test(f)
  );

  let docs = 0;
  let chunks = 0;

  for (const abs of files) {
    const rel =
      abs.split(path.join("public", "knowledge") + path.sep)[1] ??
      path.basename(abs);

    const urlPath = `/knowledge/${rel}`; // stored in kb_docs.url & kb_chunks.url
    const docKey = sha1(urlPath);        // stable unique key required by your schema
    const ext = path.extname(rel).toLowerCase();

    // 4) upsert doc row by doc_key (idempotent re-ingest)
    const title = path
      .basename(rel)
      .replace(/\.(md|markdown|txt|pdf)$/i, "")
      .replace(/[-_]/g, " ");

    const up = await sb
      .from("kb_docs")
      .upsert(
        { source_id: sourceId, url: urlPath, title, doc_key: docKey },
        { onConflict: "doc_key" }
      )
      .select("id")
      .single();
    if (up.error || !up.data?.id) throw up.error ?? new Error("Failed to upsert kb_docs");
    const docId = up.data.id; // bigint
    docs += 1;

    // 5) (re)place chunks for this doc: delete then insert fresh
    await sb.from("kb_chunks").delete().eq("doc_id", docId);

    // 6) Extract text depending on file type
    let rawText = "";
    if (ext === ".pdf") {
      rawText = await extractPdfText(abs);
    } else {
      rawText = await fs.readFile(abs, "utf8");
      // .md/.txt in your repo are JSON blobs stored as ".md" — parse if possible, otherwise index raw
      try {
        const json = JSON.parse(rawText);
        // Flatten typical JSON knowledge shapes into one string; fall back to raw
        const textBlobs: string[] = [];
        const stack: any[] = [json];
        while (stack.length) {
          const cur = stack.pop();
          if (typeof cur === "string") textBlobs.push(cur);
          else if (Array.isArray(cur)) stack.push(...cur);
          else if (cur && typeof cur === "object") stack.push(...Object.values(cur));
        }
        rawText = (textBlobs.join(" ").trim() || rawText);
      } catch {
        // keep rawText as-is (plain text markdown)
      }
    }

    if (!rawText) continue;

    // 7) Chunk & embed
    const chunksToEmbed = chunkText(rawText, 1200);
    if (chunksToEmbed.length === 0) continue;

    const vectors = await embed(chunksToEmbed.map((p) => p.content));
    const rows = chunksToEmbed.map((p, i) => ({
      doc_id: docId,          // bigint
      section: p.section,
      content: p.content,
      url: urlPath,           // kb_chunks.url exists in your schema
      embedding: vectors[i],  // public.vector accepts float[]
    }));

    const ins = await sb.from("kb_chunks").insert(rows);
    if (ins.error) throw ins.error;

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
