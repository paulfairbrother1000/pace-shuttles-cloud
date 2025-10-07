// app/api/home-hydrate/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSbAdmin } from "@supabase/supabase-js";

type Row<T extends object> = T & { [k: string]: any };

export const runtime = "nodejs";        // ensure Node runtime
export const dynamic = "force-dynamic"; // avoid static caching

/**
 * Build a Supabase client suitable for server-side reads.
 * - If SUPABASE_SERVICE_ROLE is present, use it (server-only, bypasses RLS).
 * - Else, fall back to SSR anon client with cookies (RLS must allow reads).
 */
function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  if (serviceKey) {
    // Server-side admin client (no cookies needed)
    return createSbAdmin(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  // Fallback: SSR anon client (RLS must allow the required selects)
  const cookieStore = cookies();
  return createServerClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name) => cookieStore.get(name)?.value } }
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const countryId = searchParams.get("country_id");
    const supabase = getServerSupabase();

    if (!countryId) {
      // -------- Global hydrate --------
      // 1) Countries (public info)
      const { data: countries, error: cErr } = await supabase
        .from("countries")
        .select("id,name,description,picture_url")
        .order("name", { ascending: true });
      if (cErr) throw new Error(cErr.message);

      // 2) Determine "verified" routes (active route + active assignment pointing to active vehicle)
      const [{ data: assignments, error: aErr }, { data: vehicles, error: vErr }, { data: routes, error: rErr }] =
        await Promise.all([
          supabase
            .from("route_vehicle_assignments")
            .select("route_id, vehicle_id, is_active")
            .eq("is_active", true),
          supabase
            .from("vehicles")
            .select("id, active"),
          supabase
            .from("routes")
            .select("id, country_id, destination_id, is_active"),
        ]);

      if (aErr) throw new Error(aErr.message);
      if (vErr) throw new Error(vErr.message);
      if (rErr) throw new Error(rErr.message);

      const activeVehicleIds = new Set((vehicles ?? []).filter(v => v.active !== false).map(v => v.id));
      const activeRoutes = (routes ?? []).filter(r => r.is_active !== false);
      const assignedRouteIds = new Set(
        (assignments ?? [])
          .filter(a => activeVehicleIds.has(a.vehicle_id))
          .map(a => a.route_id)
      );
      const verifiedRoutes = activeRoutes.filter(r => assignedRouteIds.has(r.id));

      // Countries that have at least one verified route
      const available_country_ids = Array.from(
        new Set(verifiedRoutes.map(r => r.country_id).filter(Boolean))
      ) as string[];

      // By-country allowed destinations for filtering on the client
      const available_destinations_by_country: Record<string, string[]> = {};
      for (const r of verifiedRoutes) {
        if (!r.country_id || !r.destination_id) continue;
        if (!available_destinations_by_country[r.country_id]) {
          available_destinations_by_country[r.country_id] = [];
        }
        available_destinations_by_country[r.country_id].push(r.destination_id);
      }
      for (const k of Object.keys(available_destinations_by_country)) {
        available_destinations_by_country[k] = Array.from(new Set(available_destinations_by_country[k]));
      }

      return NextResponse.json(
        { countries: countries ?? [], available_country_ids, available_destinations_by_country },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // -------- Country hydrate --------
    // Base lookups in-parallel
    const [pu, de, r, tt] = await Promise.all([
      supabase
        .from("pickup_points")
        .select("id,name,country_id,picture_url,description")
        .eq("country_id", countryId)
        .order("name", { ascending: true }),
      supabase
        .from("destinations")
        .select("id,name,country_id,picture_url,description,url")
        .eq("country_id", countryId)
        .order("name", { ascending: true }),
      supabase
        .from("routes")
        .select(`*, countries:country_id ( id, name, timezone )`)
        .eq("country_id", countryId)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase
        .from("transport_types")
        .select("id,name,description,picture_url,is_active"),
    ]);

    if (pu.error) throw new Error(pu.error.message);
    if (de.error) throw new Error(de.error.message);
    if (r.error) throw new Error(r.error.message);
    if (tt.error) throw new Error(tt.error.message);

    const routes = (r.data ?? []) as Row<{
      id: string;
      season_from?: string | null;
      season_to?: string | null;
      is_active?: boolean | null;
    }>[];

    // If no routes, return early with empty dependent arrays
    if (!routes.length) {
      return NextResponse.json(
        {
          pickups: pu.data ?? [],
          destinations: de.data ?? [],
          routes: [],
          assignments: [],
          vehicles: [],
          orders: [],
          transport_types: tt.data ?? [],
          sold_out_keys: [],
          remaining_by_key_db: {},
        },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Assignments + Vehicles for these routes
    const routeIds = routes.map(x => x.id);

    const { data: aData, error: aErr } = await supabase
      .from("route_vehicle_assignments")
      .select("id,route_id,vehicle_id,preferred,is_active")
      .in("route_id", routeIds)
      .eq("is_active", true);
    if (aErr) throw new Error(aErr.message);
    const assignments = (aData ?? []) as Row<{
      route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null;
    }>[];

    let vehicles: Row<{ id: string; active?: boolean | null; maxseats?: number | null; name?: string; operator_id?: string | null; type_id?: string | null }>[] = [];
    if (assignments.length) {
      const vehicleIds = Array.from(new Set(assignments.map((a) => a.vehicle_id)));
      if (vehicleIds.length) {
        const { data: vData, error: vErr } = await supabase
          .from("vehicles")
          .select("id,name,operator_id,type_id,active,minseats,minvalue,maxseatdiscount,maxseats")
          .in("id", vehicleIds)
          .eq("active", true);
        if (vErr) throw new Error(vErr.message);
        vehicles = (vData ?? []) as any[];
      }
    }

    // Time window for orders/capacity (6 months from current month)
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + 6, 0);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    // Orders (paid) for these routes in window
    const { data: oData, error: oErr } = await supabase
      .from("orders")
      .select("id,status,route_id,journey_date,qty")
      .eq("status", "paid")
      .in("route_id", routeIds)
      .gte("journey_date", ymd(windowStart))
      .lte("journey_date", ymd(windowEnd));
    if (oErr) throw new Error(oErr.message);

    // Sold-out keys (optional view)
    let sold_out_keys: string[] = [];
    try {
      const { data: soldData, error: soldErr } = await supabase
        .from("vw_soldout_keys")
        .select("route_id,journey_date");
      if (soldErr) throw soldErr;
      sold_out_keys = (soldData ?? []).map((k: any) => `${k.route_id}_${k.journey_date}`);
    } catch {
      sold_out_keys = [];
    }

    // Remaining capacity per route/day (optional view)
    let remaining_by_key_db: Record<string, number> = {};
    try {
      const { data: capRows, error: capErr } = await supabase
        .from("vw_route_day_capacity")
        .select("route_id, ymd, remaining")
        .in("route_id", routeIds)
        .gte("ymd", ymd(windowStart))
        .lte("ymd", ymd(windowEnd));
      if (capErr) throw capErr;
      remaining_by_key_db = Object.fromEntries(
        (capRows ?? []).map((r: any) => [`${r.route_id}_${r.ymd}`, Number(r.remaining ?? 0)])
      );
    } catch {
      remaining_by_key_db = {};
    }

    return NextResponse.json(
      {
        pickups: pu.data ?? [],
        destinations: de.data ?? [],
        routes,
        assignments,
        vehicles,
        orders: oData ?? [],
        transport_types: tt.data ?? [],
        sold_out_keys,
        remaining_by_key_db,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
