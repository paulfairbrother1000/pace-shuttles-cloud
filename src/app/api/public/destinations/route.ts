import { NextResponse } from "next/server";
import { supaAnon } from "../_lib/db";

export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const countryId = url.searchParams.get("country_id"); // internal filter only
  const activeParam = url.searchParams.get("active");   // "true" | "false" | null
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const supa = supaAnon();

  let query = supa
    .from("ps_public_destinations_v")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (countryId) query = query.eq("country_id", countryId);
  if (activeParam !== null) query = query.eq("active", activeParam === "true");
  if (q) {
    const safe = q.replace(/[%_]/g, (s) => `\\${s}`);
    query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Hide internal IDs
  const rows = (data ?? []).map(({ id, country_id, ...rest }) => rest);

  return NextResponse.json(
    { ok: true, rows, count: count ?? 0 },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" } }
  );
}
