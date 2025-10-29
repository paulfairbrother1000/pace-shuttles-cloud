// src/app/api/public/search/route.ts
import { NextResponse } from "next/server";
import { supaAnon } from "../_lib/db";
export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const includes = new Set((url.searchParams.get("include") || "countries,destinations,pickups,vehicle-types,journeys")
    .split(",").map(s => s.trim()).filter(Boolean));
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 20);

  const supa = supaAnon();
  const safe = q.replace(/[%_]/g, m => `\\${m}`);

  const tasks: Promise<any>[] = [];
  const out: any = {};

  if (includes.has("countries")) tasks.push(
    supa.from("ps_public_countries_v").select("*", { count: "exact" })
      .or(q ? `name.ilike.%${safe}%,description.ilike.%${safe}%` : undefined as any)
      .order("name", { ascending: true }).limit(limit)
      .then(({ data, count }) => out.countries = { rows: (data??[]).map(({id,code,...r})=>r), count: count??0 })
  );

  if (includes.has("destinations")) tasks.push(
    supa.from("ps_public_destinations_v").select("*", { count: "exact" })
      .or(q ? `name.ilike.%${safe}%,description.ilike.%${safe}%` : undefined as any)
      .order("name", { ascending: true }).limit(limit)
      .then(({ data, count }) => out.destinations = { rows: (data??[]).map(({id,country_id,...r})=>r), count: count??0 })
  );

  if (includes.has("pickups")) tasks.push(
    supa.from("ps_public_pickups_v").select("*", { count: "exact" })
      .or(q ? `name.ilike.%${safe}%,town.ilike.%${safe}%` : undefined as any)
      .order("name", { ascending: true }).limit(limit)
      .then(({ data, count }) => out.pickups = { rows: (data??[]).map(({id,country_id,transport_type_id,transport_type_place_id,...r})=>r), count: count??0 })
  );

  if (includes.has("vehicle-types")) tasks.push(
    supa.from("ps_public_vehicle_types_v").select("*", { count: "exact" })
      .or(q ? `name.ilike.%${safe}%,description.ilike.%${safe}%` : undefined as any)
      .order("sort_order", { ascending: true }).order("name", { ascending: true }).limit(limit)
      .then(({ data, count }) => out.vehicle_types = { rows: (data??[]).map(({id,...r})=>r), count: count??0 })
  );

  if (includes.has("journeys")) tasks.push(
    supa.from("ps_public_journeys_v").select("*", { count: "exact" })
      // Don’t filter by q unless you intend to (names already exposed)
      .order("starts_at", { ascending: true }).limit(limit)
      .then(({ data, count }) => {
        const rows = (data??[]).map(({ id, route_id, country_id, pickup_id, destination_id, base_price_cents, ...rest }) => rest);
        out.journeys = { rows, count: count??0 };
      })
  );

  await Promise.all(tasks);

  return NextResponse.json(
    { ok: true, ...out },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=600" } }
  );
}
