import { NextResponse } from "next/server";
import { supaAnon } from "../_lib/db";

export const runtime = "edge";

// NOTE: We call the SECURITY DEFINER function directly (rpc), then filter in code.
// This side-steps any view/rls quirks and will return rows as long as the GRANT EXECUTE exists.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const activeParam = url.searchParams.get("active");       // "true" | "false" | null
  const date = url.searchParams.get("date");                // YYYY-MM-DD
  const q = (url.searchParams.get("q") || "").trim();       // free-text on names
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const supa = supaAnon();

  // 1) Fetch raw rows from the definer function (bypasses RLS on base tables)
  // Function returns: ids + names + starts_at + duration + currency + price + active, etc.
  const { data, error } = await supa.rpc("ps_public_journeys_fn");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as any[];

  // 2) Apply filters in code (cheap at ~hundreds of rows)
  if (activeParam !== null) {
    const want = activeParam === "true";
    rows = rows.filter(r => r.active === want);
  }

  if (date) {
    const start = new Date(`${date}T00:00:00Z`).getTime();
    const end   = new Date(`${date}T23:59:59.999Z`).getTime();
    rows = rows.filter(r => {
      const t = new Date(r.starts_at).getTime();
      return t >= start && t <= end;
    });
  }

  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(r =>
      String(r.pickup_name || "").toLowerCase().includes(s) ||
      String(r.destination_name || "").toLowerCase().includes(s) ||
      String(r.country_name || "").toLowerCase().includes(s) ||
      String(r.route_name || "").toLowerCase().includes(s)
    );
  }

  // 3) Sort & paginate
  rows.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const count = rows.length;
  rows = rows.slice(offset, offset + limit);

  // 4) Strip internal IDs before returning
  const clean = rows.map(
    ({ id, route_id, country_id, pickup_id, destination_id, base_price_cents, ...rest }) => rest
  );

  return NextResponse.json(
    { ok: true, rows: clean, count },
    { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=3600" } }
  );
}
