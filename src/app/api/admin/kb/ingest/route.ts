// src/app/api/admin/kb/ingest/route.ts
// Trigger by visiting /api/admin/kb/ingest (GET) or POSTing to it.
// Reads from /public/knowledge/** by default, and ALSO supports:
//  - JSON body: { sources: [ { url|path, title? } ... ] }
//  - multipart/form-data: files[] uploads
// Calls OpenAI embeddings via src/lib/ai.ts (embedDirect).
// Matches schema: kb_docs(url, doc_key, source_id, title), kb_chunks(url, ...).

import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import { supabaseService } from "@/lib/supabaseServer";
import { embed as embedDirect } from "@/lib/ai";

export const runtime = "nodejs"; // needs fs

type Chunk = { section: string | null; content: string };
type SourceItem = { url?: string; path?: string; title?: string };

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/** Split on markdown headings & a soft size limit */
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
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

/** Extract text from a PDF using pdf-parse; cleans confusing test path in errors */
async function extractPdfText(absPath: string, relNameForError?: string): Promise<string> {
  const buf = await fsp.readFile(absPath);
  if (!buf || buf.length === 0) throw new Error(`Empty PDF: ${relNameForError || absPath}`);

  const mod: any = await import("pdf-parse");
  const pdfParse: (input: any) => Promise<any> = mod?.default ?? mod;
  if (typeof pdfParse !== "function") throw new Error("pdf-parse import failed (no callable export)");

  try {
    const result = await pdfParse({ data: new Uint8Array(buf) });
    const text = String(result?.text ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("no extractable text (image-only PDF?)");
    return text;
  } catch (e: any) {
    const msg = String(e?.message || e || "pdf-parse failure")
      .replace("./test/data/05-versions-space.pdf", "(pdf-parse test path)");
    throw new Error(`${msg} [${relNameForError || absPath}]`);
  }
}

/** Use your OpenAI helper directly */
async function embed(texts: string[]): Promise<number[][]> {
  return await embedDirect(texts);
}

/* ----------------------- helpers for new inputs ----------------------- */
function tmpFile(ext = "") {
  const name = `ing_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  return path.join("/tmp", name);
}

async function downloadToTmp(url: string): Promise<{ tmpPath: string; suggestedTitle: string }> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  const ext =
    ct.includes("pdf") ? ".pdf" :
    ct.includes("msword") ? ".doc" :
    ct.includes("officedocument") ? ".docx" : "";
  const out = tmpFile(ext);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(out, buf);
  const suggestedTitle = path.basename(new URL(url).pathname || "document").replace(/\.[^.]+$/, "");
  return { tmpPath: out, suggestedTitle };
}

function normalizeTitleFromPath(p: string, fallback = "Document") {
  return path.basename(p).replace(/\.(md|markdown|txt|pdf)$/i, "").replace(/[-_]/g, " ") || fallback;
}

/* ----------------------- core doc ingest ----------------------- */
async function upsertDocAndChunks(
  sb: ReturnType<typeof supabaseService>,
  sourceId: string,
  logicalUrl: string,       // stable logical URL (for doc_key)
  title: string,            // display title
  textExtractor: () => Promise<string> // function to extract raw text
): Promise<{ ok: true; docId: number; chunks: number } | { ok: false; reason: string }> {

  const docKey = sha1(logicalUrl);

  const up = await sb
    .from("kb_docs")
    .upsert(
      { source_id: sourceId, url: logicalUrl, title, doc_key: docKey },
      { onConflict: "doc_key" }
    )
    .select("id")
    .single();

  if (up.error || !up.data?.id) {
    return { ok: false, reason: up.error?.message ?? "kb_docs upsert failed" };
  }
  const docId = up.data.id as number;

  await sb.from("kb_chunks").delete().eq("doc_id", docId);

  let rawText = "";
  try {
    rawText = await textExtractor();
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "text extraction failed" };
  }

  // Flatten JSONish MD files, if any
  try {
    const maybeJson = JSON.parse(rawText);
    const textBlobs: string[] = [];
    const stack: any[] = [maybeJson];
    while (stack.length) {
      const cur = stack.pop();
      if (typeof cur === "string") textBlobs.push(cur);
      else if (Array.isArray(cur)) stack.push(...cur);
      else if (cur && typeof cur === "object") stack.push(...Object.values(cur));
    }
    const flat = textBlobs.join(" ").trim();
    if (flat) rawText = flat;
  } catch {
    /* not JSON; keep as-is */
  }

  const parts = chunkText(rawText, 1200);
  if (parts.length === 0) return { ok: false, reason: "no extractable text" };

  let vectors: number[][];
  try {
    vectors = await embed(parts.map((p) => p.content));
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? "embedding failed" };
  }

  const rows = parts.map((p, i) => ({
    doc_id: docId,
    section: p.section,
    content: p.content,
    url: logicalUrl,
    embedding: vectors[i],
  }));

  const ins = await sb.from("kb_chunks").insert(rows);
  if (ins.error) return { ok: false, reason: ins.error.message };

  return { ok: true, docId, chunks: rows.length };
}

/* ----------------------- orchestrator ----------------------- */
async function doIngest(req: Request) {
  const kbRoot = path.join(process.cwd(), "public", "knowledge");
  const hasKbFolder = fs.existsSync(kbRoot);

  const sb = supabaseService();

  // Ensure/resolve source row
  let sourceId: string | null = null;
  {
    const { data } = await sb.from("kb_sources").select("id").eq("name", "Default Source").maybeSingle();
    if (data?.id) sourceId = data.id as string;
    else {
      const ins = await sb.from("kb_sources").insert({ name: "Default Source", audience: "public" }).select("id").single();
      sourceId = (ins.data as any)?.id ?? null;
    }
  }
  if (!sourceId) throw new Error("Could not create/find kb_sources row");

  const results = { docs: 0, chunks: 0, skipped: [] as Array<{ file: string; reason: string }> };

  const ctype = (req.headers.get("content-type") || "").toLowerCase();

  /* ---------- MODE 1: multipart uploads ---------- */
  if (ctype.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    for (const f of files) {
      const tmp = tmpFile(path.extname(f.name));
      try {
        await fsp.writeFile(tmp, Buffer.from(await f.arrayBuffer()));
        const logicalUrl = `upload://${f.name}`;
        const title = normalizeTitleFromPath(f.name);
        const ext = path.extname(f.name).toLowerCase();

        const textExtractor = async () =>
          ext === ".pdf" ? extractPdfText(tmp, f.name) : fsp.readFile(tmp, "utf8");

        const res = await upsertDocAndChunks(sb, sourceId, logicalUrl, title, textExtractor);
        if (!res.ok) results.skipped.push({ file: f.name, reason: res.reason });
        else { results.docs += 1; results.chunks += res.chunks; }
      } catch (e: any) {
        results.skipped.push({ file: f.name, reason: String(e?.message || e) });
      } finally {
        fsp.unlink(tmp).catch(() => {});
      }
    }

    return results;
  }

  /* ---------- MODE 2: JSON body with sources ---------- */
  if (ctype.startsWith("application/json")) {
    const json = await req.json().catch(() => ({}));
    const list: SourceItem[] = Array.isArray(json?.sources) ? json.sources : [];
    for (const it of list) {
      const label = it.url || it.path || it.title || "unknown";
      let tmpLocal = "";
      try {
        if (it.url) {
          const dl = await downloadToTmp(it.url);
          tmpLocal = dl.tmpPath;
          const logicalUrl = it.url; // use the actual URL as canonical
          const title = it.title || dl.suggestedTitle || "Document";
          const ext = path.extname(tmpLocal).toLowerCase();

          const textExtractor = async () =>
            ext === ".pdf" ? extractPdfText(tmpLocal, label) : fsp.readFile(tmpLocal, "utf8");

          const res = await upsertDocAndChunks(sb, sourceId, logicalUrl, title, textExtractor);
          if (!res.ok) results.skipped.push({ file: label, reason: res.reason });
          else { results.docs += 1; results.chunks += res.chunks; }
        } else if (it.path) {
          const abs = path.resolve(process.cwd(), it.path);
          if (!fs.existsSync(abs)) {
            results.skipped.push({ file: label, reason: `ENOENT: not found at ${it.path}` });
            continue;
          }
          const logicalUrl = it.path.startsWith("public/")
            ? "/" + it.path.replace(/^public\//, "")
            : `file://${it.path}`;
          const title = it.title || normalizeTitleFromPath(abs);
          const ext = path.extname(abs).toLowerCase();

          const textExtractor = async () =>
            ext === ".pdf" ? extractPdfText(abs, it.path) : fsp.readFile(abs, "utf8");

          const res = await upsertDocAndChunks(sb, sourceId, logicalUrl, title, textExtractor);
          if (!res.ok) results.skipped.push({ file: label, reason: res.reason });
          else { results.docs += 1; results.chunks += res.chunks; }
        } else {
          results.skipped.push({ file: label, reason: "No url or path provided" });
        }
      } catch (e: any) {
        results.skipped.push({ file: label, reason: String(e?.message || e) });
      } finally {
        if (tmpLocal && tmpLocal.startsWith("/tmp/")) fsp.unlink(tmpLocal).catch(() => {});
      }
    }

    return results;
  }

  /* ---------- MODE 3: legacy scan of /public/knowledge/** ---------- */
  if (!hasKbFolder) throw new Error("Folder public/knowledge not found");

  const files = (await walk(kbRoot))
    .filter((f) => /\.(md|markdown|txt|pdf)$/i.test(f))
    .sort();

  for (const abs of files) {
    const rel = abs.split(path.join("public", "knowledge") + path.sep)[1] ?? path.basename(abs);
    const logicalUrl = `/knowledge/${rel}`; // what you previously stored in kb_docs.url & kb_chunks.url
    const title = normalizeTitleFromPath(rel);

    const ext = path.extname(rel).toLowerCase();
    const textExtractor = async () =>
      ext === ".pdf" ? extractPdfText(abs, rel) : fsp.readFile(abs, "utf8");

    const res = await upsertDocAndChunks(sb, sourceId, logicalUrl, title, textExtractor);
    if (!res.ok) results.skipped.push({ file: rel, reason: res.reason });
    else { results.docs += 1; results.chunks += res.chunks; }
  }

  return results;
}

/* ================= HTTP handlers ================= */
export async function GET(req: Request) {
  try {
    const result = await doIngest(req);
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
    const result = await doIngest(req);
    return NextResponse.json({ ok: true, method: "POST", ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, method: "POST", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
