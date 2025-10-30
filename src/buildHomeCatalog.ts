// src/buildHomeCatalog.ts
// Single source of truth for the homepage + /api/public/visible-catalog

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type UUID = string;

export type VisibleRoute = {
  route_id: UUID;
  route_name: string;
  country_id?: UUID | null;
  country_name?: string | null;
  destination_id?: UUID | null;
  destination_name?: string | null;
  pickup_id?: UUID | null;
  pickup_name?: string | null;
  vehicle_type_id?: UUID | null;
  vehicle_type_name?: string | null;
};

export type VisibleCatalog = {
  routes: VisibleRoute[];
  countries: Array<{ id?: UUID | null; name: string; description?: string | null; hero_image_url?: string | null }>;
  destinations: Array<{
    name: string;
    country_name?: string | null;
    description?: string | null;
    address1?: string | null;
    address2?: string | null;
    town?: string | null;
    region?: string | null;
    postal_code?: string | null;
    phone?: string | null;
    website_url?: string | null;
    image_url?: string | null;
    directions_url?: string | null;
    type?: string | null;
    tags?: string[] | null;
  }>;
  pickups: Array<{ name: string; country_name?: string | null; directions_url?: string | null }>;
  vehicle_types: Array<{ id: UUID; name: string; description?: string | null; icon_url?: string | null; capacity?: number | null; features?: string[] | null }>;
};

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Prefer service role on the server so RLS can't hide public rows
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
function lc(s: string | null | undefined) {
  return (s ?? "").toLowerCase();
}

/** Build the home/agent visible catalog strictly from visible routes */
export async function buildHomeCatalog(): Promise<VisibleCatalog> {
  const supabase = sb();

  // 1) Visible routes (the SSOT for "markets in play")
  const { data: routes, error: rErr } = await supabase
    .from("visible_routes_v")
    .select(
      `
      route_id:id,
      route_name:name,
      country_id,
      country_name,
      destination_id,
      destination_name,
      pickup_id,
      pickup_name,
      vehicle_type_id,
      vehicle_type_name
    `
    );

  if (rErr) throw rErr;
  const routesSafe: VisibleRoute[] = (routes ?? []) as any[];

  // If there are no routes, short-circuit (API should still return ok:true, but empty arrays)
  if (!routesSafe.length) {
    return { routes: [], countries: [], destinations: [], pickups: [], vehicle_types: [] };
  }

  // 2) Derive the visible “keys” from the routes
  const visibleCountryNames = uniq(
    routesSafe.map(r => r.country_name).filter(Boolean) as string[]
  );
  const visibleDestinationNamesLC = new Set(
    routesSafe.map(r => lc(r.destination_name)).filter(Boolean)
  );
  const visiblePickupNamesLC = new Set(
    routesSafe.map(r => lc(r.pickup_name)).filter(Boolean)
  );
  const visibleVehicleTypeIds = uniq(
    routesSafe.map(r => r.vehicle_type_id).filter(Boolean) as UUID[]
  );

  // 3) Load the base catalog tables (unfiltered)
  const [{ data: countriesAll }, { data: destAll }, { data: pickupsAll }] = await Promise.all([
    supabase.from("countries").select("id,name,description,hero_image_url"),
    supabase
      .from("destinations")
      .select(
        "name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags"
      ),
    supabase.from("pickup_points").select("name,country_name,directions_url"),
  ]);

  // 4) Filter to *visible-only* (based on routes)
  const countries = (countriesAll ?? []).filter(c =>
    visibleCountryNames.includes(c.name)
  );

  const destinations = (destAll ?? []).filter(d =>
    visibleDestinationNamesLC.has(lc(d.name))
  );

  const pickups = (pickupsAll ?? []).filter(p =>
    visiblePickupNamesLC.has(lc(p.name))
  );

  // 5) Vehicle types: prefer `transport_types`; fall back to `vehicle_types` if present
  let vehicle_types: VisibleCatalog["vehicle_types"] = [];
  {
    // Try transport_types first
    const { data: ttypes } = await supabase
      .from("transport_types")
      .select("id,name,description,icon_url,capacity,features")
      .in("id", visibleVehicleTypeIds);
    if (ttypes && ttypes.length) {
      vehicle_types = ttypes as any;
    } else {
      // Fallback in case your schema/table name is different
      const { data: vtypes } = await supabase
        .from("vehicle_types")
        .select("id,name,description,icon_url,capacity,features")
        .in("id", visibleVehicleTypeIds);
      vehicle_types = (vtypes ?? []) as any;
    }
  }

  return {
    routes: routesSafe,
    countries,
    destinations,
    pickups,
    vehicle_types,
  };
}

export default buildHomeCatalog;
