// src/app/api/tools/searchPublicKB/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// body: { query: string, topK?: number }
export async function POST(req: Request) {
  try {
    const { query, topK = 6 } = await req.json();
    if (!query) return NextResponse.json({ matches: [] });

    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get() {}, set() {}, remove() {} } }
    );

    // 1) get embedding for query
    const embeddingRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ai/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [query] })
    });
    const { embeddings } = await embeddingRes.json();
    const qvec = embeddings?.[0];
    if (!qvec) return NextResponse.json({ matches: [] });

    // 2) vector search over PUBLIC audience
    const { data, error } = await sb.rpc("kb_public_search", {
      query_embedding: qvec,
      match_count: topK
    });
    if (error) return NextResponse.json({ matches: [], error: error.message }, { status: 500 });

    // Expect rpc to join kb_chunks -> kb_docs -> kb_sources and filter audience='public'
    // Normalize shape for the agent
    const matches = (data ?? []).map((r: any) => ({
      id: r.chunk_id,
      title: r.doc_title,
      section: r.section ?? null,
      snippet: r.content?.slice(0, 400) ?? "",
      url: r.uri ?? null,
      score: r.similarity
    }));

    return NextResponse.json({ matches });
  } catch (e: any) {
    return NextResponse.json({ matches: [], error: e?.message }, { status: 400 });
  }
}
