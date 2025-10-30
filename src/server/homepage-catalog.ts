// src/server/homepage-catalog.ts
// Goal: reuse the exact homepage loader so homepage & agent stay in lockstep.

export type VisibleRoute = {
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

export type VisibleCatalog = {
  routes: VisibleRoute[];
  countries: Array<{
    id?: string | null;
    name: string;
    description?: string | null;
    hero_image_url?: string | null;
  }>;
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
  vehicle_types: Array<{ id: string; name: string; description?: string | null; icon_url?: string | null; capacity?: number | null; features?: string[] | null }>;
};

// ------------- Replace this import with your real homepage loader -------------
// Example: if your homepage exports a server function buildHomeCatalog():
// import { buildHomeCatalog } from "@/app/(site)/_server/buildHomeCatalog";
//
// Then implement getVisibleCatalog as a thin pass-through:
export async function getVisibleCatalog(): Promise<VisibleCatalog> {
  // return await buildHomeCatalog();

  // TEMP scaffolding to avoid typescript errors until you wire the real loader:
  // Delete this stub once you hook up your actual homepage function.
  throw new Error(
    "Wire this adapter to your homepage’s server loader (e.g., buildHomeCatalog) and return {routes, countries, destinations, pickups, vehicle_types}."
  );
}
