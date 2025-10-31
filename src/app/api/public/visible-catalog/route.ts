// src/app/api/public/visible-catalog/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const API_BASE = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://www.paceshuttles.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ensure no caching by Next.js
export const dynamic = "force-dynamic";

async function loadVisibleCatalog() {
  const { data: routes, error: rErr } = await supabase
    .from("visible_routes_v")
    .select(
      `id as route_id,
       name as route_name,
       country_id,
       country_name,
       destination_id,
       destination_name,
       pickup_id,
       pickup_name,
       vehicle_type_id,
       vehicle_type_name`
    );

  if (rErr) throw rErr;

  const { data: countries } = await supabase
    .from("countries")
    .select("id,name,description,hero_image_url");
  const { data: destinations } = await supabase
    .from("destinations")
    .select("name,country_name,description,address1,address2,town,region,postal_code,phone,website_url,image_url,directions_url,type,tags");
  const { data: pickups } = await supabase
    .from("pickup_points")
    .select("name,country_name,directions_url");
  const { data: vehicle_types } = await supabase
    .from("transport_types")
    .select("id,name,description,icon_url,capacity,features");

  return {
    ok: true,
    fallback: false,
    routes: routes ?? [],
    countries: countries ?? [],
    destinations: destinations ?? [],
    pickups: pickups ?? [],
    vehicle_types: vehicle_types ?? [],
  };
}

async function fallbackPublicCatalog() {
  const [countries, destinations, pickups, vehicle_types] = await Promise.all([
    fetch(`${API_BASE}/api/public/countries`).then((r) => r.json()).catch(() => []),
    fetch(`${API_BASE}/api/public/destinations`).then((r) => r.json()).catch(() => []),
    fetch(`${API_BASE}/api/public/pickups`).then((r) => r.json()).catch(() => []),
    fetch(`${API_BASE}/api/public/vehicle-types`).then((r) => r.json()).catch(() => []),
  ]);

  return {
    ok: true,
    fallback: true,
    routes: [],
    countries,
    destinations,
    pickups,
    vehicle_types,
  };
}

export async function GET() {
  try {
    const cat = await loadVisibleCatalog();
    if (cat.routes.length > 0) {
      return NextResponse.json(cat, {
        headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
      });
    }

    const fallback = await fallbackPublicCatalog();
    return NextResponse.json(fallback);
  } catch (err: any) {
    console.warn("[visible-catalog] fallback triggered:", err.message);
    const fb = await fallbackPublicCatalog();
    return NextResponse.json(fb);
  }
}
