// src/lib/rag.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embed } from "./ai";

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

type Retrieved = { content: string; doc_id: string; score: number };

export async function retrieveSimilar(query: string, opts: { signedIn: boolean; k?: number } = { signedIn: false }) {
  const k = opts.k ?? 6;
  const [qvec] = await embed([query]);
  const sb = serviceClient();

  // choose view
  const view = opts.signedIn ? "vw_kb_chunks_all" : "vw_kb_chunks_public";

  const { data, error } = await sb.rpc("match_kb_chunks", {
    match_count: k,
    query_embedding: qvec,
    chunks_view: view,
  });

  if (error) throw error;

  return (data as any[]).map((r) => ({
    content: r.content as string,
    doc_id: r.doc_id as string,
    score: Number(r.similarity),
  })) as Retrieved[];
}
