// scripts/ingest.ts
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { embed } from "../src/lib/ai";

const KB_ROOT = path.resolve(process.cwd(), "knowledge");
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

function chunkText(t: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    out.push(t.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return out;
}

async function ensureSource(sb: any, name: string, audience: "public"|"internal") {
  const { data } = await sb.from("kb_sources").select("id").eq("name", name).maybeSingle();
  if (data?.id) return data.id;
  const { data: ins, error } = await sb.from("kb_sources").insert({ name, audience }).select("id").single();
  if (error) throw error;
  return ins.id;
}

async function upsertDoc(sb: any, source_id: string, title: string, uri: string | null, mime: string) {
  const { data } = await sb.from("kb_docs").insert({ source_id, title, uri, mime }).select("id").single();
  return data.id as string;
}

async function ingestFile(sb: any, filePath: string, audience: "public"|"internal") {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const title = base.replace(ext, "");
  const sourceId = await ensureSource(sb, "Website & Collateral", audience);

  let raw = await fs.readFile(filePath, "utf8");
  // very small sanitizer
  raw = raw.replace(/\r\n/g, "\n").trim();
  const chunks = chunkText(raw);

  const docId = await upsertDoc(sb, sourceId, title, null, "text/markdown");

  const embeddings = await embed(chunks);
  const rows = chunks.map((content, i) => ({
    doc_id: docId,
    chunk_index: i,
    content,
    embedding: embeddings[i],
  }));

  // Bulk insert in batches
  const batchSize = 200;
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const { error } = await sb.from("kb_chunks").insert(slice);
    if (error) throw error;
  }
  console.log(`Ingested: ${base} (${rows.length} chunks)`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const files = (await fs.readdir(KB_ROOT))
    .filter(f => /\.md$|\.txt$/i.test(f))  // keep simple to avoid PDF parsing here
    .map(f => path.join(KB_ROOT, f));

  for (const file of files) {
    // Decide audience by filename convention: *.public.md => public; else internal
    const audience = /\.public\./i.test(file) ? "public" : "internal";
    await ingestFile(sb, file, audience as any);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
