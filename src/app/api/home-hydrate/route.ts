// app/api/home-hydrate/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type Row<T extends object> = T & { [k: string]: any };

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const countryId = searchParams.get("country_id");

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // anon OK for read with RLS
      { cookies: { get: (name) => cookieStore.get(name)?.value } }
    );

    if (!countryId) {
      // -------- Global hydrate --------
      // 1) Countries
      const { data: countries, error: cErr } = await supabase
        .from("countries")
        .select("id,name,description,picture_url")
        .order("name");

      if (cErr) throw new Error(cErr.message);

      // 2) Availability sets (server-side verification)
      const { data: assignments, error: aErr } = await supabase
        .from("route_vehicle_assignments")
        .select("route_id, vehicle_id, is_active")
        .eq("is_active", true);

      if (aErr) throw new Error(aErr.message);

      const { data: vehicles, error: vErr } = await supabase
        .from("vehicles")
        .select("id, active");

      if (vErr) throw new Error(vErr.message);

      const activeVehicleIds = new Set((vehicles ?? []).filter(v => v.active !== false).map(v => v.id));

      const { data: routes, error: rErr } = await supabase
        .from("routes")
        .select("id, country_id, destination_id, is_active");

      if (rErr) throw new Error(rErr.message);

      const activeRoutes = (routes ?? []).filter(r => r.is_active !== false);
      const assignedRouteIds = new Set((assignments ?? []).filter(a => activeVehicleIds.has(a.vehicle_id)).map(a => a.route_id));
      const verifiedRoutes = activeRoutes.filter(r => assignedRouteIds.has(r.id));

      const available_country_ids = Array.from(new Set(verifiedRoutes.map(r => r.country_id).filter(Boolean))) as string[];
      const available_destinations_by_country: Record<string, string[]> = {};
      for (const r of verifiedRoutes) {
        if (!r.country_id || !r.destination_id) continue;
        if (!available_destinations_by_country[r.country_id]) available_destinations_by_country[r.country_id] = [];
        available_destinations_by_country[r.country_id].push(r.destination_id);
      }
      // unique each list
      for (const k of Object.keys(available_destinations_by_country)) {
        available_destinations_by_country[k] = Array.from(new Set(available_destinations_by_country[k]));
      }

      return NextResponse.json(
        { countries: countries ?? [], available_country_ids, available_destinations_by_country },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    // -------- Country hydrate --------
    const [pu, de, r, tt] = await Promise.all([
      supabase.from("pickup_points").select("id,name,country_id,picture_url,description").eq("country_id", countryId).order("name"),
      supabase.from("destinations").select("id,name,country_id,picture_url,description,url").eq("country_id", countryId).order("name"),
      supabase
        .from("routes")
        .select(`*, countries:country_id ( id, name, timezone )`)
        .eq("country_id", countryId)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      supabase.from("transport_types").select("id,name,description,picture_url,is_active"),
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

    // Assignments + Vehicles for these routes
    const routeIds = routes.map(x => x.id);
    let assignments: Row<{ route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null }>[] = [];
    let vehicles: Row<{ id: string; active?: boolean | null; maxseats?: number | null }>[] = [];
    if (routeIds.length) {
      const { data: aData, error: aErr } = await supabase
        .from("route_vehicle_assignments")
        .select("id,route_id,vehicle_id,preferred,is_active")
        .in("route_id", routeIds)
        .eq("is_active", true);
      if (aErr) throw new Error(aErr.message);
      assignments = (aData ?? []) as any[];

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

    // Orders (paid) in 6-month window
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + 6, 0);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    const { data: oData, error: oErr } = await supabase
      .from("orders")
      .select("id,status,route_id,journey_date,qty")
      .eq("status", "paid")
      .gte("journey_date", ymd(windowStart))
      .lte("journey_date", ymd(windowEnd));

    if (oErr) throw new Error(oErr.message);

    // Sold-out keys
    let sold_out_keys: string[] = [];
    try {
      const { data: soldData, error: soldErr } = await supabase.from("vw_soldout_keys").select("route_id,journey_date");
      if (soldErr) throw soldErr;
      sold_out_keys = (soldData ?? []).map((k: any) => `${k.route_id}_${k.journey_date}`);
    } catch {
      sold_out_keys = [];
    }

    // Remaining capacity per route/day
    let remaining_by_key_db: Record<string, number> = {};
    try {
      if (routeIds.length) {
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
      }
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
