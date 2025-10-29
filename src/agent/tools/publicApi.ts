const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://www.paceshuttles.com";

type ApiOk<T> = { ok: true; rows: T[]; count: number };
type Country = {
  name: string; description: string; hero_image_url: string;
  charity_name: string; charity_url: string; charity_description: string;
  active: boolean; timezone: string | null;
};
type Destination = {
  name: string; country_name: string;
  address1: string; address2: string; town: string; region: string; postal_code: string;
  website_url: string; image_url: string; directions_url: string; description: string;
  active: boolean;
};
type Pickup = {
  name: string; country_name: string;
  address1: string; address2: string; town: string; region: string; postal_code: string;
  description: string; image_url: string; directions_url: string; active: boolean;
};
type VehicleType = {
  name: string; description: string; seats_min: number; seats_max: number;
  image_url: string; active: boolean; slug: string; sort_order: number;
};
type Journey = {
  pickup_name: string; destination_name: string; country_name: string; route_name: string;
  starts_at: string; departure_time: string; days_of_week: string;
  duration_min: number; currency: string; price_per_seat_from: number; active: boolean;
};

async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    usp.set(k, String(v));
  }
  const url = `${BASE}${path}${usp.toString() ? `?${usp}` : ""}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as ApiOk<T>;
}

export const PublicApi = {
  countries: (q?: string, active?: boolean) => get<Country>("/api/public/countries", { q, active }),
  destinations: (opts: { q?: string; country_id?: string; active?: boolean; limit?: number } = {}) =>
    get<Destination>("/api/public/destinations", opts),
  pickups: (opts: { q?: string; country_id?: string; active?: boolean; limit?: number } = {}) =>
    get<Pickup>("/api/public/pickups", opts),
  vehicleTypes: (q?: string, active?: boolean) =>
    get<VehicleType>("/api/public/vehicle-types", { q, active }),
  journeys: (opts: { q?: string; date?: string; active?: boolean; limit?: number } = {}) =>
    get<Journey>("/api/public/journeys", opts),
};
