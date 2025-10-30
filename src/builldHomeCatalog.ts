import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // server-only

export async function buildHomeCatalog() {
  const supa = createClient(url, key, { auth: { persistSession: false } });

  // TODO: replace with your actual tables/views & joins
  // Tip: define a DB VIEW `visible_routes_v` that already applies the business rules.
  const { data: routes } = await supa
    .from("visible_routes_v")
    .select("route_id, route_name, country_name, destination_name, pickup_name, vehicle_type_id, vehicle_type_name");

  const { data: countriesAll } = await supa.from("countries_public_v").select("*").eq("active", true);
  const { data: destinationsAll } = await supa.from("destinations_public_v").select("*").eq("active", true);
  const { data: pickups } = await supa.from("pickups_public_v").select("*");
  const { data: vehicle_types } = await supa.from("vehicle_types").select("*");

  const visibleCountryNames = Array.from(new Set((routes ?? []).map(r => r.country_name).filter(Boolean)));
  const countries = (countriesAll ?? []).filter(c => visibleCountryNames.includes(c.name));

  const visibleDestNames = new Set((routes ?? []).map(r => (r.destination_name || "").toLowerCase()));
  const destinations = (destinationsAll ?? []).filter(d => visibleDestNames.has((d.name || "").toLowerCase()));

  return { routes: routes ?? [], countries, destinations, pickups: pickups ?? [], vehicle_types: vehicle_types ?? [] };
}
