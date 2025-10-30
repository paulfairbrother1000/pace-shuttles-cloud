// src/buildHomeCatalog.ts
// Single source of truth for the homepage + /api/public/visible-catalog
// Robust against column/view name drift and RLS issues.

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
function pick<T = any>(row: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (row && row[k] !== undefined && row[k] !== null) return row[k] as T;
  }
  return undefined;
}

/** Normalize an arbitrary row coming from a visible routes view into our VisibleRoute shape */
function normalizeRoute(row: any): VisibleRoute {
  const route_id =
    pick<string>(row, "route_id", "id", "routeid") ?? crypto.randomUUID();
  const route_name =
    pick<string>(row, "route_name", "name", "routename") ?? "Route";
  const country_id = pick<string | null>(row, "country_id");
  const country_name = pick<string | null>(row, "country_name");
  const destination_id = pick<string | null>(row, "destination_id");
  const destination_name = pick<string | null>(row, "destination_name");
  const pickup_id = pick<string | null>(row, "pickup_id");
  const pickup_name = pick<string | null>(row, "pickup_name");
  const vehicle_type_id =
    pick<string | null>(row, "vehicle_type_id", "transport_type_id") ?? null;
  const vehicle_type_name =
    pick<string | null>(row, "vehicle_type_name", "transport_type_name") ?? null;

  return {
    route_id,
    route_name,
    country_id: country_id ?? null,
    country_name: country_name ?? null,
    destination_id: destination_id ?? null,
    destination_name: destination_name ?? null,
    pickup_id: pickup_id ?? null,
    pickup_name: pickup_name ?? null,
    vehicle_type_id,
    vehicle_type_name,
  };
}

/** Build the home/agent visible catalog strictly from visible routes */
export async function buildHomeCatalog(): Promise<VisibleCatalog> {
  const supabase = sb();

  // 1) Visible routes (the SSOT for "markets in play"). Try both schema-qualified and unqualified names.
  const routeSources = ["public.visible_routes_v", "visible_routes_v"] as const;
  let routesRaw: any[] | null = null;
  let lastErr: any = null;

  for (const source of routeSources) {
    const { data, error } = await supabase.from(source).select("*");
    if (error) {
      lastErr = error;
      continue; // try next source
    }
    routesRaw = data ?? [];
    break;
  }

  if (routesRaw == null) {
    // Could not load from any source; surface a helpful error so the API wrapper can fallback:true
    throw new Error(
      `[buildHomeCatalog] failed to read visible routes view (${routeSources.join(
        " OR "
      )}): ${lastErr?.message || lastErr || "unknown error"}`
    );
  }

  const routesSafe: VisibleRoute[] = routesRaw.map(normalizeRoute);

  // If there are no routes, return empty (API will still be ok:true but with empty arrays)
  if (!routesSafe.length) {
    return { routes: [], countries: [], destinations: [], pickups: [], vehicle_types: [] };
  }

  // 2) Derive the visible “keys” from the routes
  const visibleCountryNames = uniq(
    routesSafe.map((r) => r.country_name).filter(Boolean) as string[]
  );
  const visibleDestinationNamesLC = new Set(
    routesSafe.map((r) => lc(r.destination_name)).filter(Boolean)
  );
  const visiblePickupNamesLC = new Set(
    routesSafe.map((r) => lc(r.pickup_name)).filter(Boolean)
  );
  const visibleVehicleTypeIds = uniq(
    routesSafe.map((r) => r.vehicle_type_id).filter(Boolean) as UUID[]
  );

  // 3) Load the base catalog tables (unfiltered)
  // These are public-facing lists; we still use server client to be safe.
  const [{ data: countriesAll, error: cErr }, { data: destAll, error: dErr }, { data: pickupsAll, error: pErr }] =
    await Promise.all([
      supabase.from("countries").select("id,name,description,hero_image_url"),
      supabase
        .from("destinations")
        .select(
          "name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags"
        ),
      supabase.from("pickup_points").select("name,country_name,directions_url"),
    ]);

  if (cErr) throw new Error(`[buildHomeCatalog] countries read failed: ${cErr.message}`);
  if (dErr) throw new Error(`[buildHomeCatalog] destinations read failed: ${dErr.message}`);
  if (pErr) throw new Error(`[buildHomeCatalog] pickups read failed: ${pErr.message}`);

  // 4) Filter to *visible-only* (based on routes)
  const countries = (countriesAll ?? []).filter((c) =>
    visibleCountryNames.includes(c.name)
  );

  const destinations = (destAll ?? []).filter((d) =>
    visibleDestinationNamesLC.has(lc(d.name))
  );

  const pickups = (pickupsAll ?? []).filter((p) =>
    visiblePickupNamesLC.has(lc(p.name))
  );

  // 5) Vehicle types: prefer `transport_types`; fall back to `vehicle_types`
  let vehicle_types: VisibleCatalog["vehicle_types"] = [];
  {
    // Try transport_types first (your current schema)
    const { data: ttypes, error: tErr } = await supabase
      .from("transport_types")
      .select("id,name,description,icon_url,capacity,features")
      .in("id", visibleVehicleTypeIds);

    if (!tErr && ttypes && ttypes.length) {
      vehicle_types = ttypes as any;
    } else {
      // Fallback if table name differs in an environment
      const { data: vtypes, error: vErr } = await supabase
        .from("vehicle_types")
        .select("id,name,description,icon_url,capacity,features")
        .in("id", visibleVehicleTypeIds);

      if (vErr && visibleVehicleTypeIds.length) {
        // Only noisy if we actually expected some types
        throw new Error(`[buildHomeCatalog] transport/vehicle types read failed: ${tErr?.message || vErr?.message}`);
      }
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
