// src/app/api/public/visible-catalog/route.ts
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";   // always fresh
export const runtime = "nodejs";           // supabase-js friendly

const API_BASE = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://www.paceshuttles.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE || ""; // do NOT silently fall back to anon

function sb(): SupabaseClient | null {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

/* ---------- helpers to read public endpoints (fallback) ---------- */
type Rowed<T> = { ok?: boolean; rows?: T[] } | T[];

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
async function getRows<T>(url: string): Promise<T[]> {
  const data = await safeJson<Rowed<T>>(await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } }));
  if (Array.isArray(data)) return data;
  if (data && "rows" in data && Array.isArray((data as any).rows)) return (data as any).rows as T[];
  return [];
}
const lc = (s?: string | null) => (s ?? "").toLowerCase();

/* ---------- primary loader (SSOT via Supabase view) ---------- */
async function loadVisibleCatalog() {
  const supabase = sb();
  if (!supabase) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)");

  // IMPORTANT: Supabase aliasing is `alias:column`, not `column as alias`
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
  const routesSafe = (routes ?? []) as Array<{
    route_id: string;
    route_name: string;
    country_id?: string | null;
    country_name?: string | null;
    destination_id?: string | null;
    destination_name?: string | null;
    pickup_id?: string | null;
    pickup_name?: string | null;
    vehicle_type_id?: string | null;
    vehicle_type_name?: string | null;
  }>;

  // Short-circuit if no routes
  if (!routesSafe.length) {
    return {
      ok: true,
      fallback: false,
      routes: [],
      countries: [],
      destinations: [],
      pickups: [],
      vehicle_types: [],
    };
  }

  // Derive visibility strictly from routes
  const visibleCountryNames = Array.from(new Set(routesSafe.map(r => r.country_name).filter(Boolean) as string[]));
  const visibleDestNamesLC = new Set(routesSafe.map(r => lc(r.destination_name)).filter(Boolean));
  const visiblePickupNamesLC = new Set(routesSafe.map(r => lc(r.pickup_name)).filter(Boolean));
  const visibleVehicleTypeIds = Array.from(new Set(routesSafe.map(r => r.vehicle_type_id).filter(Boolean) as string[]));

  // Base tables (unfiltered)
  const [{ data: countriesAll }, { data: destAll }, { data: pickupsAll }] = await Promise.all([
    supabase.from("countries").select("id,name,description,hero_image_url"),
    supabase.from("destinations").select("name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags"),
    supabase.from("pickup_points").select("name,country_name,directions_url"),
  ]);

  // Filter to visible-only
  const countries = (countriesAll ?? []).filter(c => visibleCountryNames.includes(c.name));
  const destinations = (destAll ?? []).filter(d => visibleDestNamesLC.has(lc(d.name)));
  const pickups = (pickupsAll ?? []).filter(p => visiblePickupNamesLC.has(lc(p.name)));

  // Transport/vehicle types (prefer transport_types; fall back to vehicle_types)
  let vehicle_types: Array<{ id: string; name: string; description?: string | null; icon_url?: string | null; capacity?: number | null; features?: string[] | null }> = [];
  if (visibleVehicleTypeIds.length) {
    const { data: ttypes } = await supabase
      .from("transport_types")
      .select("id,name,description,icon_url,capacity,features")
      .in("id", visibleVehicleTypeIds);
    if (ttypes?.length) {
      vehicle_types = ttypes as any;
    } else {
      const { data: vtypes } = await supabase
        .from("vehicle_types")
        .select("id,name,description,icon_url,capacity,features")
        .in("id", visibleVehicleTypeIds);
      vehicle_types = (vtypes ?? []) as any;
    }
  }

  return {
    ok: true,
    fallback: false,
    routes: routesSafe,
    countries,
    destinations,
    pickups,
    vehicle_types,
  };
}

/* ---------- graceful fallback (public endpoints only) ---------- */
async function fallbackPublicCatalog(reason?: string) {
  type Country = { id?: string | null; name: string; description?: string | null; hero_image_url?: string | null };
  type Destination = { name: string; country_name?: string | null; description?: string | null; address1?: string | null; address2?: string | null; town?: string | null; region?: string | null; postal_code?: string | null; phone?: string | null; website_url?: string | null; image_url?: string | null; directions_url?: string | null; type?: string | null; tags?: string[] | null; active?: boolean | null };
  type Pickup = { name: string; country_name?: string | null; directions_url?: string | null };
  type VehicleType = { id: string; name: string; description?: string | null; icon_url?: string | null; capacity?: number | null; features?: string[] | null };

  const [countriesRaw, destinationsRaw, pickupsRaw, vehicle_types] = await Promise.all([
    getRows<Country>(`${API_BASE}/api/public/countries`).catch(() => []),
    getRows<Destination>(`${API_BASE}/api/public/destinations`).catch(() => []),
    getRows<Pickup>(`${API_BASE}/api/public/pickups`).catch(() => []),
    getRows<VehicleType>(`${API_BASE}/api/public/vehicle-types`).catch(() => []),
  ]);

  const activeDestinations = destinationsRaw.filter(d => d.active !== false);
  const visibleCountryNames = Array.from(new Set(activeDestinations.map(d => (d.country_name || "").trim()).filter(Boolean)));
  const countries = countriesRaw.filter(c => visibleCountryNames.includes(c.name));

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

/* ---------- GET handler ---------- */
export async function GET() {
  try {
    try {
      const cat = await loadVisibleCatalog();
      if (cat.routes.length > 0) {
        return NextResponse.json(cat, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
      }
    } catch (e: any) {
      console.warn("[visible-catalog] primary failed; using fallback:", e?.message || e);
      const fb = await fallbackPublicCatalog(e?.message || "primary_failed");
      return NextResponse.json(fb, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
    }

    // No routes from primary but also no throw → fallback
    const fb = await fallbackPublicCatalog("no_routes");
    return NextResponse.json(fb, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
  } catch (err: any) {
    console.error("[visible-catalog] fatal:", err?.message || err);
    return NextResponse.json({ ok: false, error: "visible_catalog_failed" }, { status: 500 });
  }
}
