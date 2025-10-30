// src/lib/agent/ssot.ts
// Single Source of Truth helpers for the chat agent, mirroring the homepage logic.

type UUID = string;

export type Country = { id: UUID; name: string; description?: string | null; picture_url?: string | null };
export type Pickup = { id: UUID; name: string; country_id: UUID; picture_url?: string | null; description?: string | null; town_region?: string | null };
export type Destination = { id: UUID; name: string; country_id: UUID | null; picture_url?: string | null; description?: string | null; town_region?: string | null; url?: string | null };
export type RouteRow = {
  id: UUID;
  route_name: string | null;
  country_id: UUID | null;
  pickup_id: UUID | null;
  destination_id: UUID | null;
  approx_duration_mins: number | null;
  pickup_time: string | null;
  frequency: string | null;
  season_from?: string | null;
  season_to?: string | null;
  is_active?: boolean | null;
  transport_type?: string | null;
  countries?: { id: UUID; name: string; timezone?: string | null } | null;
};
export type Assignment = { id: UUID; route_id: UUID; vehicle_id: UUID; preferred?: boolean | null; is_active?: boolean | null; };
export type Vehicle = {
  id: UUID;
  name: string;
  active?: boolean | null;
  type_id?: UUID | null;
  maxseats?: number | string | null;
};
export type HydrateGlobal = {
  countries: Country[];
  available_destinations_by_country: Record<UUID, UUID[]>;
};
export type HydrateCountry = {
  pickups: Pickup[];
  destinations: Destination[];
  routes: RouteRow[];
  transport_types: { id: UUID; name: string; description?: string | null; picture_url?: string | null; is_active?: boolean | null }[];
  assignments: Assignment[];
  vehicles: Vehicle[];
  orders: { id: UUID; status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired"; route_id: UUID | null; journey_date: string | null; qty: number | null }[];
  sold_out_keys: string[];
  remaining_by_key_db: Record<string, number>;
};

// Utility: fetch JSON with no-store (matches homepage)
async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} for ${url}: ${snippet}`);
  }
  return res.json() as Promise<T>;
}

// SSOT fetchers (exactly what the homepage uses)
export async function getHomeHydrate(): Promise<HydrateGlobal> {
  return fetchJSON<HydrateGlobal>("/api/home-hydrate");
}

export async function getCountryHydrate(countryId: UUID): Promise<HydrateCountry> {
  const qs = new URLSearchParams({ country_id: countryId });
  return fetchJSON<HydrateCountry>(`/api/home-hydrate?${qs.toString()}`);
}

/**
 * Operating countries TODAY
 * Definition: Countries with at least one destination available (same as homepage’s
 * visibleCountries logic based on available_destinations_by_country keys)
 */
export function computeOperatingCountries(global: HydrateGlobal): Country[] {
  const availableSet = new Set(Object.keys(global.available_destinations_by_country || {}));
  return (global.countries || []).filter(c => availableSet.has(c.id));
}

/**
 * Roadmap countries (active in DB but no visible destinations yet).
 * If you want “all active=true”, fetch from your DB; here we derive roadmap as:
 * countries in global.countries that are NOT currently “operating”.
 */
export function computeRoadmapCountries(global: HydrateGlobal): Country[] {
  const operatingIds = new Set(computeOperatingCountries(global).map(c => c.id));
  return (global.countries || []).filter(c => !operatingIds.has(c.id));
}

/**
 * Verified routes for a country (has an ACTIVE assignment to an ACTIVE vehicle with capacity)
 * — mirrors the homepage’s verifiedRoutes pipeline.
 */
export function computeVerifiedRoutes(country: HydrateCountry): RouteRow[] {
  const activeVehicleIds = new Set(
    (country.vehicles || [])
      .filter(v => v?.active !== false && Number(v?.maxseats ?? 0) > 0)
      .map(v => v.id)
  );

  const routesWithActiveVehicle = new Set(
    (country.assignments || [])
      .filter(a => a.is_active !== false && activeVehicleIds.has(a.vehicle_id))
      .map(a => a.route_id)
  );

  return (country.routes || []).filter(r => routesWithActiveVehicle.has(r.id));
}

/**
 * Destinations “we visit in COUNTRY today”:
 * Only destinations that appear on at least one verified route occurrence (as homepage does).
 * We don’t expand an occurrence calendar here—agent just needs the set.
 */
export function destinationsWeVisitToday(country: HydrateCountry): Destination[] {
  const verified = computeVerifiedRoutes(country);
  const destIds = new Set(verified.map(r => r.destination_id).filter(Boolean) as UUID[]);
  return (country.destinations || []).filter(d => destIds.has(d.id));
}

/**
 * Safe label with optional town/region (guards the data issue you noted).
 */
export function destinationLabel(d: Destination): string {
  const where = (d.town_region || "").trim();
  return where ? `${d.name} — ${where}` : d.name;
}

export function pickupLabel(p: Pickup): string {
  const where = (p.town_region || "").trim();
  return where ? `${p.name} — ${where}` : p.name;
}

/**
 * Price guard: don’t show £0; if computed <= 0, return null so the agent says
 * “price shown at checkout” instead of quoting zero.
 */
export function poundsOrNull(minorUnitsPerSeat?: number | null): number | null {
  if (minorUnitsPerSeat == null || Number.isNaN(minorUnitsPerSeat)) return null;
  const pounds = Math.ceil(minorUnitsPerSeat / 100);
  return pounds > 0 ? pounds : null;
}
