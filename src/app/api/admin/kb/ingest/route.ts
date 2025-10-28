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

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** Simple chunker: split on markdown headings & size limit */
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

/** Extract text from a PDF (Node-safe) using pdf-parse with a strict data arg */
async function extractPdfText(absPath: string): Promise<string> {
  // 1) Read file as a real Buffer
  const buf = await fs.readFile(absPath);
  if (!buf || buf.length === 0) {
    throw new Error(`Empty PDF: ${absPath}`);
  }

  // 2) Import in a way that works with both CJS/ESM bundles
  const mod: any = await import("pdf-parse");
  const pdfParse: (input: any) => Promise<any> = mod?.default ?? mod;
  if (typeof pdfParse !== "function") {
    throw new Error("pdf-parse import failed (no callable export)");
  }

  // 3) Force the “data” shape so pdf-parse never tries its test fallback path
  //    (the './test/data/05-versions-space.pdf' you keep seeing)
  const result = await pdfParse({ data: new Uint8Array(buf) });

  const text = String(result?.text ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) throw new Error("No text extracted from PDF");
  return text;
}

  try {
    const result = await pdfParse(buf);
    const text = String(result?.text || "")
      .replace(/\u0000/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      // Likely a scanned (image-only) PDF without an OCR text layer
      throw new Error("no extractable text (image-only PDF?)");
    }
    return text;
  } catch (e: any) {
    const msg = String(e?.message || e || "pdf-parse failure");
    // Clean up confusing internal fallback path from pdf-parse
    if (msg.includes("test/data/05-versions-space.pdf")) {
      throw new Error(`pdf-parse did not receive a valid PDF buffer for ${relNameForError}`);
    }
    throw new Error(`${msg} [${relNameForError}]`);
  }
}

/** Use your OpenAI helper directly */
async function embed(texts: string[]): Promise<number[][]> {
  return await embedDirect(texts);
}

async function doIngest(_origin: string) {
  const kbRoot = path.join(process.cwd(), "public", "knowledge");
  await fs.access(kbRoot).catch(() => {
    throw new Error("Folder public/knowledge not found");
  });

  const sb = supabaseService();

  // Ensure a default source
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

  // Collect candidate files
  const files = (await walk(kbRoot))
    .filter((f) => /\.(md|markdown|txt|pdf)$/i.test(f))
    .sort();

  let docs = 0;
  let chunks = 0;
  const skipped: { file: string; reason: string }[] = [];

  for (const abs of files) {
    const rel =
      abs.split(path.join("public", "knowledge") + path.sep)[1] ??
      path.basename(abs);

    const urlPath = `/knowledge/${rel}`;
    const docKey = sha1(urlPath);
    const ext = path.extname(rel).toLowerCase();

    // Upsert doc row by doc_key (idempotent)
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

    if (up.error || !up.data?.id) {
      skipped.push({ file: rel, reason: up.error?.message ?? "kb_docs upsert failed" });
      continue;
    }

    const docId = up.data.id as number;
    docs += 1;

    // Replace chunks for this doc
    await sb.from("kb_chunks").delete().eq("doc_id", docId);

    // Extract text
    let rawText = "";
    try {
      if (ext === ".pdf") {
        rawText = await extractPdfText(abs, rel);
      } else {
        rawText = await fs.readFile(abs, "utf8");
        // In your repo, .md/.txt often contain JSON; flatten if possible
        try {
          const json = JSON.parse(rawText);
          const textBlobs: string[] = [];
          const stack: any[] = [json];
          while (stack.length) {
            const cur = stack.pop();
            if (typeof cur === "string") textBlobs.push(cur);
            else if (Array.isArray(cur)) stack.push(...cur);
            else if (cur && typeof cur === "object") stack.push(...Object.values(cur));
          }
          const flat = textBlobs.join(" ").trim();
          if (flat) rawText = flat;
        } catch {
          // plain markdown text; keep as-is
        }
      }
    } catch (e: any) {
      skipped.push({ file: rel, reason: e?.message ?? "text extraction failed" });
      continue;
    }

    // Chunk & embed
    const chunksToEmbed = chunkText(rawText, 1200);
    if (chunksToEmbed.length === 0) {
      skipped.push({ file: rel, reason: "no extractable text" });
      continue;
    }

    let vectors: number[][];
    try {
      vectors = await embed(chunksToEmbed.map((p) => p.content));
    } catch (e: any) {
      skipped.push({ file: rel, reason: e?.message ?? "embedding failed" });
      continue;
    }

    const rows = chunksToEmbed.map((p, i) => ({
      doc_id: docId,
      section: p.section,
      content: p.content,
      url: urlPath,
      embedding: vectors[i],
    }));

    const ins = await sb.from("kb_chunks").insert(rows);
    if (ins.error) {
      skipped.push({ file: rel, reason: ins.error.message });
      continue;
    }

    chunks += rows.length;
  }

  return { docs, chunks, skipped };
}

// === HTTP handlers ===
export async function GET(req: Request) {
  try {
    const result = await doIngest(new URL(req.url).origin);
    return NextResponse.json({ ok: true, method: "GET", ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, method: "GET", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const result = await doIngest(new URL(req.url).origin);
    return NextResponse.json({ ok: true, method: "POST", ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, method: "POST", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
