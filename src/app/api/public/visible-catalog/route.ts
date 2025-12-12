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

type GenericTypeRow = {
  id: string;
  name: string;
  description?: string | null;
  icon_url?: string | null;
  capacity?: number | null;
  features?: string[] | null;
  is_active?: boolean | null;
};

async function selectFirstExistingTable<T extends Record<string, any>>(
  supabase: SupabaseClient,
  tableNames: string[],
  selectClause: string
): Promise<T[]> {
  const errs: string[] = [];
  for (const name of tableNames) {
    const { data, error } = await supabase.from(name).select(selectClause);
    if (error) {
      errs.push(`${name}: ${error.message}`);
      continue;
    }
    return (data ?? []) as T[];
  }
  if (errs.length) {
    console.warn("[visible-catalog] type table load failed:", errs.join(" | "));
  }
  return [];
}

/* ---------- Primary (SSOT via view) ---------- */
async function loadVisibleCatalog() {
  const supabase = sb();

  // ✅ select('*') so we never break when the view column names differ
  const { data: rawRoutes, error: rErr } = await supabase
    .from("visible_routes_v")
    .select("*");

  if (rErr) throw rErr;

  const routes = (rawRoutes ?? [])
    .map(normalizeRoute)
    .filter((r) => r.route_name);

  // Base tables (these may be empty if you haven't populated them; that's fine)
  const [{ data: countriesAll }, { data: destAll }, { data: pickupsAll }] =
    await Promise.all([
      supabase.from("countries").select("id,name,description,hero_image_url"),
      supabase
        .from("destinations")
        .select(
          "name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags"
        ),
      supabase.from("pickup_points").select("name,country_name,directions_url"),
    ]);

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

  const countries = (countriesAll ?? []).filter((c) =>
    visibleCountryNames.includes(c.name)
  );
  const destinations = (destAll ?? []).filter((d) =>
    visibleDestLC.has(lc(d.name))
  );
  const pickups = (pickupsAll ?? []).filter((p) =>
    visiblePickupLC.has(lc(p.name))
  );

  // Transport / vehicle types (generic only)
  // IMPORTANT: your DB might use transport_type (singular) not transport_types.
  const [ttypesRaw, vtypesRaw] = await Promise.all([
    selectFirstExistingTable<GenericTypeRow>(
      supabase,
      ["transport_types", "transport_type"],
      "id,name,description,icon_url,capacity,features,is_active"
    ),
    selectFirstExistingTable<GenericTypeRow>(
      supabase,
      ["vehicle_types", "vehicle_type"],
      "id,name,description,icon_url,capacity,features,is_active"
    ),
  ]);

  const allTypes = [...(ttypesRaw ?? []), ...(vtypesRaw ?? [])]
    .filter((t) => {
      // if is_active exists, enforce it; otherwise include
      if ("is_active" in t && t.is_active != null) return t.is_active === true;
      return true;
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      icon_url: t.icon_url ?? null,
      capacity: t.capacity ?? null,
      features: (t.features as any) ?? null,
    }));

  // If no routes, still return types (so the agent can answer "what transport types do you have?")
  if (!routes.length) {
    return {
      ok: true,
      fallback: false as const,
      routes: [],
      countries,
      destinations,
      pickups,
      vehicle_types: allTypes,
    };
  }

  return {
    ok: true,
    fallback: false as const,
    routes,
    countries,
    destinations,
    pickups,
    vehicle_types: allTypes,
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
      return NextResponse.json(cat, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      });
    } catch (e: any) {
      console.warn(
        "[visible-catalog] primary failed; using fallback:",
        e?.message || e
      );
      const fb = await fallbackPublicCatalog(e?.message || "primary_failed");
      return NextResponse.json(fb, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      });
    }
  } catch (err: any) {
    console.error("[visible-catalog] fatal:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "visible_catalog_failed" },
      { status: 500 }
    );
  }
}
