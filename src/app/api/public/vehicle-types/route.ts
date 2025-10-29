import { NextResponse } from "next/server";
import { supaAnon } from "../_lib/db";

export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const activeParam = url.searchParams.get("active"); // optional if you want to filter by t.is_active via view

  const supa = supaAnon();

  let query = supa
    .from("ps_public_vehicle_types_v")
    .select("*", { count: "exact" })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

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
  const rows = (data ?? []).map(({ id, ...rest }) => rest);

  return NextResponse.json(
    { ok: true, rows, count: count ?? 0 },
    { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" } }
  );
}
