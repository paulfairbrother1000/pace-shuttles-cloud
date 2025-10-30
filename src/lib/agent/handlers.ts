// src/lib/agent/handlers.ts
import {
  getHomeHydrate,
  getCountryHydrate,
  computeOperatingCountries,
  computeRoadmapCountries,
  destinationsWeVisitToday,
  destinationLabel,
  pickupLabel,
} from "./ssot";

type UUID = string;

export async function agentListOperatingCountries(): Promise<string[]> {
  const g = await getHomeHydrate();
  // EXACTLY mirrors the homepage visibleCountries logic:
  return computeOperatingCountries(g).map(c => c.name);
}

export async function agentListRoadmapCountries(): Promise<string[]> {
  const g = await getHomeHydrate();
  return computeRoadmapCountries(g).map(c => c.name);
}

export async function agentDestinationsInCountry(countryId: UUID): Promise<{ name: string }[]> {
  const c = await getCountryHydrate(countryId);
  // Only destinations backed by verified routes (same filter as homepage rows)
  const list = destinationsWeVisitToday(c);
  // Include general location if present, but it’s optional (and resilient to data errors)
  return list.map(d => ({ name: destinationLabel(d) }));
}

export async function agentPickupsInCountry(countryId: UUID): Promise<{ name: string }[]> {
  const c = await getCountryHydrate(countryId);
  // Pickups used on verified routes only (not required now, but available for future Q&A)
  const verified = new Set(destinationsWeVisitToday(c).map(d => d.id));
  const routePickupIds = new Set(
    c.routes.filter(r => r.destination_id && verified.has(r.destination_id)).map(r => r.pickup_id!).filter(Boolean)
  );
  return c.pickups.filter(p => routePickupIds.has(p.id)).map(p => ({ name: pickupLabel(p) }));
}
