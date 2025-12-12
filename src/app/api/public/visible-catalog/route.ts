// src/app/api/public/visible-catalog/route.ts
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const API_BASE =
  process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://www.paceshuttles.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function sb(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** Try to read a field from multiple possible names */
function pick<T extends Record<string, any>>(row: T, ...keys: string[]) {
  for (const k of keys) if (row[k] != null) return row[k];
  return null;
}

/** Normalize an arbitrary row from visible_routes_v to our canonical shape */
function normalizeRoute(row: Record<string, any>) {
  const route_id = pick(row, "route_id", "id");
  const route_name = pick(row, "route_name", "name");

  const country_id = pick(row, "country_id", "country_uuid", "c_id");
  const country_name = pick(row, "country_name", "country");

  const destination_id = pick(row, "destination_id", "dest_id", "destination_uuid");
  const destination_name = pick(row, "destination_name", "destination");

  const pickup_id = pick(row, "pickup_id", "pickup_uuid");
  const pickup_name = pick(row, "pickup_name", "pickup");

  // NOTE:
  // We will override these later with SAFE canonical transport_types values.
  const vehicle_type_id = pick(row, "vehicle_type_id", "transport_type_id", "vtype_id");
  const vehicle_type_name = pick(row, "vehicle_type_name", "transport_type_name", "vehicle_type");

  return {
    route_id: route_id ?? undefined,
    route_name: route_name ?? "",
    country_id: country_id ?? null,
    country_name: country_name ?? null,
    destination_id: destination_id ?? null,
    destination_name: destination_name ?? null,
    pickup_id: pickup_id ?? null,
    pickup_name: pickup_name ?? null,
    vehicle_type_id: vehicle_type_id ?? null,
    vehicle_type_name: vehicle_type_name ?? null,
  };
}

type VisibleRoute = ReturnType<typeof normalizeRoute>;

type TransportTypeRow = {
  id: string;
  name: string;
  description?: string | null;
  picture_url?: string | null;
  capacity?: number | null;
  features?: string[] | null;
  is_active?: boolean | null;
  slug?: string | null;
};

type RouteVehicleAssignmentRow = {
  route_id: string;
  vehicle_id: string;
  is_active: boolean | null;
  preferred: boolean | null;
  created_at: string | null;
};

type VehicleRow = {
  id: string;
  // IMPORTANT: in your schema this is VARCHAR but contains UUIDs (transport_types.id)
  type_id: string | null;
  active: boolean | null;
  preferred: boolean | null;
};

function chooseAssignment(rows: RouteVehicleAssignmentRow[]): RouteVehicleAssignmentRow | null {
  if (!rows.length) return null;

  // prefer active=true (or null treated as true), then preferred=true, then newest created_at
  const sorted = [...rows].sort((a, b) => {
    const aActive = a.is_active === false ? 0 : 1;
    const bActive = b.is_active === false ? 0 : 1;
    if (aActive !== bActive) return bActive - aActive;

    const aPref = a.preferred ? 1 : 0;
    const bPref = b.preferred ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;

    const aTs = a.created_at ? Date.parse(a.created_at) : 0;
    const bTs = b.created_at ? Date.parse(b.created_at) : 0;
    return bTs - aTs;
  });

  return sorted[0] ?? null;
}

/**
 * Build SAFE transport typing for routes using:
 * route_vehicle_assignments -> vehicles.type_id -> transport_types
 *
 * This is the canonical mapping that prevents vessel-name leaks.
 */
async function enrichRoutesWithTransportTypes(
  supabase: SupabaseClient,
  routes: VisibleRoute[]
): Promise<{
  routes: VisibleRoute[];
  vehicle_types: TransportTypeRow[];
}> {
  const routeIds = routes
    .map((r) => (r.route_id ?? "").toString())
    .filter(Boolean);

  if (!routeIds.length) return { routes, vehicle_types: [] };

  // 1) route_vehicle_assignments for these routes
  const { data: rvaAll, error: rvaErr } = await supabase
    .from("route_vehicle_assignments")
    .select("route_id,vehicle_id,is_active,preferred,created_at")
    .in("route_id", routeIds);

  if (rvaErr) throw rvaErr;

  const rvaByRoute = new Map<string, RouteVehicleAssignmentRow[]>();
  for (const row of (rvaAll ?? []) as RouteVehicleAssignmentRow[]) {
    const rid = row.route_id;
    if (!rid) continue;
    if (!rvaByRoute.has(rid)) rvaByRoute.set(rid, []);
    rvaByRoute.get(rid)!.push(row);
  }

  // Choose one vehicle per route (preferred active, else newest)
  const chosenByRoute = new Map<string, string>(); // route_id -> vehicle_id
  const vehicleIds = new Set<string>();

  for (const rid of routeIds) {
    const chosen = chooseAssignment(rvaByRoute.get(rid) ?? []);
    if (chosen?.vehicle_id) {
      chosenByRoute.set(rid, chosen.vehicle_id);
      vehicleIds.add(chosen.vehicle_id);
    }
  }

  if (!vehicleIds.size) {
    // No assignments => we cannot type routes
    const cleared = routes.map((r) => ({
      ...r,
      vehicle_type_id: null,
      vehicle_type_name: null,
    }));
    return { routes: cleared, vehicle_types: [] };
  }

  // 2) vehicles -> type_id (transport_types.id as string)
  const { data: vehiclesAll, error: vErr } = await supabase
    .from("vehicles")
    .select("id,type_id,active,preferred")
    .in("id", Array.from(vehicleIds));

  if (vErr) throw vErr;

  const vehicleTypeIdByVehicle = new Map<string, string>();
  const typeIds = new Set<string>();

  for (const v of (vehiclesAll ?? []) as VehicleRow[]) {
    const vid = (v.id ?? "").toString();
    const tid = (v.type_id ?? "").toString().trim();
    if (!vid || !tid) continue;
    vehicleTypeIdByVehicle.set(vid, tid);
    typeIds.add(tid);
  }

  if (!typeIds.size) {
    const cleared = routes.map((r) => ({
      ...r,
      vehicle_type_id: null,
      vehicle_type_name: null,
    }));
    return { routes: cleared, vehicle_types: [] };
  }

  // 3) transport_types -> id/name (canonical safe names)
  const { data: typesAll, error: tErr } = await supabase
    .from("transport_types")
    .select("id,name,description,picture_url,is_active,slug")
    .in("id", Array.from(typeIds));

  if (tErr) throw tErr;

  const typeNameById = new Map<string, string>();
  const usedTypes: TransportTypeRow[] = [];

  for (const t of (typesAll ?? []) as TransportTypeRow[]) {
    const id = (t.id ?? "").toString();
    const name = (t.name ?? "").toString();
    if (!id || !name) continue;
    typeNameById.set(id, name);
    usedTypes.push(t);
  }

  // 4) apply to routes (override any polluted fields from the view)
  const enriched = routes.map((r) => {
    const rid = (r.route_id ?? "").toString();
    const chosenVehicleId = chosenByRoute.get(rid) ?? "";
    const typeId = chosenVehicleId ? vehicleTypeIdByVehicle.get(chosenVehicleId) ?? "" : "";
    const typeName = typeId ? typeNameById.get(typeId) ?? "" : "";

    return {
      ...r,
      vehicle_type_id: typeId || null,
      vehicle_type_name: typeName || null, // SAFE canonical name only
    };
  });

  // return only the types we actually used on routes (and optionally only active)
  const vehicle_types = usedTypes
    .filter((t) => t && t.id && t.name)
    .filter((t) => t.is_active !== false);

  return { routes: enriched, vehicle_types };
}

/* ---------- Primary (SSOT via view) ---------- */
async function loadVisibleCatalog() {
  const supabase = sb();

  // ✅ select('*') so we never break when the view column names differ
  const { data: rawRoutes, error: rErr } = await supabase
    .from("visible_routes_v")
    .select("*");

  if (rErr) throw rErr;

  let routes = (rawRoutes ?? [])
    .map(normalizeRoute)
    .filter((r) => r.route_name);

  if (!routes.length) {
    return {
      ok: true,
      fallback: false as const,
      routes: [],
      countries: [],
      destinations: [],
      pickups: [],
      vehicle_types: [],
    };
  }

  // ✅ CRITICAL FIX:
  // Replace polluted / null vehicle typing from the view with canonical transport_types
  const typed = await enrichRoutesWithTransportTypes(supabase, routes);
  routes = typed.routes;

  // Derive visibility strictly from routes
  const visibleCountryNames = Array.from(
    new Set(routes.map((r) => r.country_name).filter(Boolean) as string[])
  );
  const visibleDestLC = new Set(
    routes.map((r) => lc(r.destination_name)).filter(Boolean)
  );
  const visiblePickupLC = new Set(
    routes.map((r) => lc(r.pickup_name)).filter(Boolean)
  );

  // Base tables
  const [{ data: countriesAll }, { data: destAll }, { data: pickupsAll }] =
    await Promise.all([
      supabase.from("countries").select(
        "id,name,description,hero_image_url"
      ),
      supabase
        .from("destinations")
        .select(
          "name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags"
        ),
      supabase
        .from("pickup_points")
        .select("name,country_name,directions_url"),
    ]);

  // Filter to visible-only
  const countries = (countriesAll ?? []).filter((c) =>
    visibleCountryNames.includes(c.name)
  );
  const destinations = (destAll ?? []).filter((d) =>
    visibleDestLC.has(lc(d.name))
  );
  const pickups = (pickupsAll ?? []).filter((p) =>
    visiblePickupLC.has(lc(p.name))
  );

  // ✅ vehicle_types is now the SAFE canonical list actually used on routes
  const vehicle_types = typed.vehicle_types.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? null,
    icon_url: t.picture_url ?? null,
    capacity: t.capacity ?? null,
    features: t.features ?? null,
  }));

  return {
    ok: true,
    fallback: false as const,
    routes,
    countries,
    destinations,
    pickups,
    vehicle_types,
  };
}

/* ---------- Fallback (public endpoints only) ---------- */
type Rowed<T> = { ok?: boolean; rows?: T[] } | T[];

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function getRows<T>(url: string): Promise<T[]> {
  const data = await safeJson<Rowed<T>>(
    await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
  );
  if (Array.isArray(data)) return data;
  if (data && "rows" in data && Array.isArray((data as any).rows)) {
    return (data as any).rows as T[];
  }
  return [];
}

async function fallbackPublicCatalog(reason?: string) {
  type Country = {
    id?: string | null;
    name: string;
    description?: string | null;
    hero_image_url?: string | null;
  };
  type Destination = {
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
    active?: boolean | null;
  };
  type Pickup = {
    name: string;
    country_name?: string | null;
    directions_url?: string | null;
  };
  type VehicleType = {
    id: string;
    name: string;
    description?: string | null;
    icon_url?: string | null;
    capacity?: number | null;
    features?: string[] | null;
  };

  const [countriesRaw, destinationsRaw, pickupsRaw, vehicle_types] =
    await Promise.all([
      getRows<Country>(`${API_BASE}/api/public/countries`).catch(() => []),
      getRows<Destination>(`${API_BASE}/api/public/destinations`).catch(
        () => []
      ),
      getRows<Pickup>(`${API_BASE}/api/public/pickups`).catch(() => []),
      getRows<VehicleType>(`${API_BASE}/api/public/vehicle-types`).catch(
        () => []
      ),
    ]);

  const activeDestinations = destinationsRaw.filter(
    (d) => d.active !== false
  );
  const visibleCountryNames = Array.from(
    new Set(
      activeDestinations
        .map((d) => (d.country_name || "").trim())
        .filter(Boolean)
    )
  );
  const countries = countriesRaw.filter((c) =>
    visibleCountryNames.includes(c.name)
  );

  return {
    ok: true,
    fallback: true as const,
    reason: reason || undefined,
    routes: [] as any[],
    countries,
    destinations: activeDestinations,
    pickups: pickupsRaw,
    vehicle_types,
  };
}

/* ---------- GET ---------- */
export async function GET() {
  try {
    try {
      const cat = await loadVisibleCatalog();
      if (cat.routes.length > 0) {
        return NextResponse.json(cat, {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=60",
          },
        });
      }
    } catch (e: any) {
      console.warn("[visible-catalog] primary failed; using fallback:", e?.message || e);
      const fb = await fallbackPublicCatalog(e?.message || "primary_failed");
      return NextResponse.json(fb, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      });
    }

    const fb = await fallbackPublicCatalog("no_routes");
    return NextResponse.json(fb, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  } catch (err: any) {
    console.error("[visible-catalog] fatal:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "visible_catalog_failed" },
      { status: 500 }
    );
  }
}
