// src/app/api/public/visible-catalog/route.ts
import { NextResponse } from "next/server";
import { getVisibleCatalog } from "@/server/homepage-catalog";

const API_BASE = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://www.paceshuttles.com";

// Ensure this route is always fresh (your loader can add its own caching)
export const dynamic = "force-dynamic";

type Rowed<T> = { ok?: boolean; rows?: T[] };

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

type Pickup = { name: string; country_name?: string | null; directions_url?: string | null };
type VehicleType = { id: string; name: string; description?: string | null; icon_url?: string | null; capacity?: number | null; features?: string[] | null };

type VisibleRoute = {
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
};

async function safeJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json() as Promise<T>;
}
async function getRows<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const data = await safeJson<Rowed<T> | T[]>(res);
  if (Array.isArray(data)) return data as T[];
  if (data && "rows" in data && Array.isArray((data as any).rows)) return (data as Rowed<T>).rows as T[];
  return [];
}

/**
 * Fallback: derive a useful public catalog ONLY from public endpoints,
 * filtered to "active" where available. No prices/routes here.
 */
async function fallbackPublicCatalog() {
  const [countries, destinations, pickups, vehicle_types] = await Promise.all([
    getRows<Country>(`${API_BASE}/api/public/countries`).catch(() => []),
    getRows<Destination>(`${API_BASE}/api/public/destinations`).catch(() => []),
    getRows<Pickup>(`${API_BASE}/api/public/pickups`).catch(() => []),
    getRows<VehicleType>(`${API_BASE}/api/public/vehicle-types`).catch(() => []),
  ]);

  const activeDestinations = destinations.filter((d) => d.active !== false);

  // Derive countries from destinations present (keeps this honest without hard-coding)
  const visibleCountryNames = Array.from(
    new Set(activeDestinations.map((d) => (d.country_name || "").trim()).filter(Boolean))
  );

  const derivedCountries = countries.filter((c) => visibleCountryNames.includes(c.name));

  return {
    ok: true,
    // No route discovery in fallback (prevents calling /api/quote without IDs)
    routes: [] as VisibleRoute[],
    countries: derivedCountries,
    destinations: activeDestinations,
    pickups,
    vehicle_types,
    fallback: true as const,
  };
}

export async function GET() {
  try {
    // PHASE 2: call the homepage’s real loader (best case)
    try {
      const cat = await getVisibleCatalog(); // must be wired by you in src/server/homepage-catalog.ts
      if (cat && Array.isArray(cat.routes) && cat.routes.length > 0) {
        return NextResponse.json(
          {
            ok: true,
            routes: cat.routes,
            countries: cat.countries ?? [],
            destinations: cat.destinations ?? [],
            pickups: cat.pickups ?? [],
            vehicle_types: cat.vehicle_types ?? [],
            fallback: false,
          },
          { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } }
        );
      }
    } catch (e) {
      // swallow and drop to fallback
      console.warn("[visible-catalog] primary loader failed; using fallback:", (e as any)?.message || e);
    }

    // PHASE 1: graceful fallback—still useful (countries/destinations/types)
    const fallback = await fallbackPublicCatalog();
    return NextResponse.json(fallback, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
  } catch (err: any) {
    console.error("[visible-catalog] fatal:", err?.message || err);
    return NextResponse.json({ ok: false, error: "visible_catalog_failed" }, { status: 500 });
  }
}
