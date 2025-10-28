// scripts/ingest.ts
// Ingest .md/.txt knowledge files into Supabase vector store.
// Audience: 'public' if filename contains `.public.`, else 'internal'.
//
// ENV required:
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
// Optional:
//   OPENAI_API_KEY=sk-...               (preferred for embeddings)
//   NEXT_PUBLIC_BASE_URL=https://...    (fallback embedding endpoint)
//   KB_ROOT=src/app/knowledge           (path to your files; default ./knowledge)
//
// Run:
//   npx ts-node scripts/ingest.ts
//   KB_ROOT=src/app/knowledge npx ts-node scripts/ingest.ts

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// -------- Config --------
const KB_ROOT = process.env.KB_ROOT
  ? path.resolve(process.cwd(), process.env.KB_ROOT)
  : path.resolve(process.cwd(), "knowledge");

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;
const EMBEDDING_DIMS = 1536; // text-embedding-3-small

// -------- Helpers --------
function assertEnv(name: string) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

function chunkText(t: string): string[] {
  const text = t.replace(/\r\n/g, "\n").trim();
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + CHUNK_SIZE));
    i += Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);
  }
  return out.length ? out : [text];
}

function isPublicAudience(filePath: string) {
  return /\.public\./i.test(path.basename(filePath));
}

function titleFromFilename(filePath: string) {
  const base = path.basename(filePath);
  return base.replace(path.extname(base), "");
}

async function listFilesRecursive(dir: string, exts = [".md", ".txt"]) {
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listFilesRecursive(full, exts)));
    } else if (exts.includes(path.extname(e.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

// Preferred: direct OpenAI embeddings
async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set for embedOpenAI");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: texts,
      model: "text-embedding-3-small",
    }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || "Embedding failed");
  return (json.data || []).map((d: any) => d.embedding as number[]);
}

// Fallback: your own API route at NEXT_PUBLIC_BASE_URL/api/ai/embed
async function embedViaAppRoute(texts: string[]): Promise<number[][]> {
  const base = assertEnv("NEXT_PUBLIC_BASE_URL");
  const res = await fetch(`${base}/api/ai/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(json?.error || "Embedding failed (app route)");
  if (!Array.isArray(json.embeddings)) throw new Error("Invalid embed response");
  return json.embeddings as number[][];
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (process.env.OPENAI_API_KEY) return embedOpenAI(texts);
  return embedViaAppRoute(texts);
}

// -------- Supabase access --------
const SUPABASE_URL = assertEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = assertEnv("SUPABASE_SERVICE_ROLE_KEY");
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Ensure a kb_sources row exists; return id
async function ensureSource(name: string, audience: "public" | "internal") {
  // try exact match by (name, audience)
  const { data: existing, error: selErr } = await sb
    .from("kb_sources")
    .select("id, audience")
    .eq("name", name)
    .maybeSingle();

  if (selErr) {
    // if not existing, maybe it's multiple; fall back to insert
  } else if (existing?.id && existing.audience === audience) {
    return existing.id as string;
  }

  // create new (distinct) source row (you can consolidate later if desired)
  const { data, error } = await sb
    .from("kb_sources")
    .insert({ name, audience })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

// Insert a kb_docs row; if a doc with same (source_id,title) exists, reuse it
async function upsertDoc(source_id: string, title: string, uri: string | null, mime: string) {
  // check by (source_id, title)
  const { data: existing } = await sb
    .from("kb_docs")
    .select("id")
    .eq("source_id", source_id)
    .eq("title", title)
    .maybeSingle();

  if (existing?.id) {
    return existing.id as string;
  }

  const { data, error } = await sb
    .from("kb_docs")
    .insert({ source_id, title, uri, mime })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

// Delete existing chunks for a doc (so re-ingest replaces content)
async function deleteChunksForDoc(doc_id: string) {
  const { error } = await sb.from("kb_chunks").delete().eq("doc_id", doc_id);
  if (error) throw error;
}

// Bulk insert chunks with embeddings
async function insertChunks(
  doc_id: string,
  chunks: string[],
  embeddings: number[][]
) {
  if (embeddings.length !== chunks.length) {
    throw new Error("Embeddings length mismatch");
  }
  // quick shape check
  if (!Array.isArray(embeddings[0]) || embeddings[0].length !== EMBEDDING_DIMS) {
    console.warn(
      `Warning: expected ${EMBEDDING_DIMS}-dim embeddings, got ${embeddings[0]?.length}`
    );
  }

  const rows = chunks.map((content, i) => ({
    doc_id,
    chunk_index: i,
    content,
    embedding: embeddings[i],
  }));

  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const { error } = await sb.from("kb_chunks").insert(slice);
    if (error) throw error;
  }
}

// -------- Main ingest --------
async function ingestFile(filePath: string) {
  const rel = path.relative(process.cwd(), filePath);
  const audience: "public" | "internal" = isPublicAudience(filePath) ? "public" : "internal";

  // Source naming: change as you see fit; using folder name at KB_ROOT for grouping
  const sourceName = "Website & Collateral";

  const source_id = await ensureSource(sourceName, audience);

  const title = titleFromFilename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".txt" ? "text/plain" : "text/markdown";

  const raw = await fs.readFile(filePath, "utf8");
  const chunks = chunkText(raw);

  if (chunks.length === 0) {
    console.log(`Skip empty file: ${rel}`);
    return;
  }

  const doc_id = await upsertDoc(source_id, title, null, mime);

  // Replace old chunks for this doc
  await deleteChunksForDoc(doc_id);

  // Embed and insert
  const embeds = await getEmbeddings(chunks);
  await insertChunks(doc_id, chunks, embeds);

  console.log(`Ingested: ${rel}  (${chunks.length} chunks)  [audience=${audience}]`);
}

async function main() {
  // Sanity env
  assertEnv("NEXT_PUBLIC_SUPABASE_URL");
  assertEnv("SUPABASE_SERVICE_ROLE_KEY");

  // List files
  const files = await listFilesRecursive(KB_ROOT, [".md", ".txt"]);
  if (files.length === 0) {
    console.log(`No .md/.txt files found under: ${KB_ROOT}`);
    process.exit(0);
  }

  console.log(`KB_ROOT = ${KB_ROOT}`);
  console.log(`Files to ingest = ${files.length}`);

  for (const f of files) {
    try {
      await ingestFile(f);
    } catch (e: any) {
      console.error(`Failed: ${f}`);
      console.error(e?.message || e);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
