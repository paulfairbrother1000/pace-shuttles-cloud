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

export type Retrieved = {
  content: string;
  doc_id: string;
  score: number;
  // Optional metadata (populate if your RPC/view joins kb_docs/kb_sources)
  title?: string | null;
  section?: string | null;
  url?: string | null;
};

export async function retrieveSimilar(
  query: string,
  opts: { signedIn: boolean; k?: number } = { signedIn: false }
): Promise<Retrieved[]> {
  const k = Math.max(1, Math.min(16, opts.k ?? 6));
  const [qvec] = await embed([query]);
  const sb = serviceClient();

  // Choose the chunks view based on auth; these views should LEFT JOIN doc/source meta if available.
  const view = opts.signedIn ? "vw_kb_chunks_all" : "vw_kb_chunks_public";

  const { data, error } = await sb.rpc("match_kb_chunks", {
    match_count: k,
    query_embedding: qvec,
    chunks_view: view,
  });

  if (error) throw error;

  // Map defensively: if your RPC doesn’t expose these fields yet, they’ll just be null
  return (data as any[]).map((r) => {
    const title = (r.doc_title ?? r.title ?? null) as string | null;
    const section = (r.section ?? r.heading ?? null) as string | null;
    const url = (r.uri ?? r.url ?? null) as string | null;

    return {
      content: String(r.content ?? ""),
      doc_id: String(r.doc_id ?? r.document_id ?? ""),
      score: Number(r.similarity ?? r.score ?? 0),
      title,
      section,
      url,
    } as Retrieved;
  });
}
