// src/server/homepage-catalog.ts
// Thin adapter so BOTH homepage and /api/public/visible-catalog use the SAME server logic.

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
  countries: Array<{ id?: string | null; name: string; description?: string | null; hero_image_url?: string | null }>;
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

// Replace this with your actual homepage loader import
// Example:
// import { buildHomeCatalog } from "@/app/(site)/_server/buildHomeCatalog";

export async function getVisibleCatalog(): Promise<VisibleCatalog> {
  // return await buildHomeCatalog();

  // TEMP: throw so the API falls back gracefully until you wire the real function.
  throw new Error("getVisibleCatalog() not wired to homepage loader yet.");
}
