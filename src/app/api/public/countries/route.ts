import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supaAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Optional: run on the Edge (fine for simple reads); remove if you prefer node.
export const runtime = "edge";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const activeParam = searchParams.get("active"); // "true" | "false" | null
  const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10), 0);

  const supa = supaAnon();

  let query = supa
    .from("ps_public_countries_v")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (activeParam !== null) {
    query = query.eq("active", activeParam === "true");
  }

  if (q) {
    // Search name + description (case-insensitive)
    // Supabase OR syntax requires columns joined by commas inside one string.
    query = query.or(
      `name.ilike.%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%,description.ilike.%${q
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_")}%`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ok: true, rows: data ?? [], count: count ?? 0 },
    {
      headers: {
        // Cache at the edge for 5 minutes; allow stale while revalidating
        "Cache-Control": "s-maxage=300, stale-while-revalidate=86400",
      },
    }
  );
}
