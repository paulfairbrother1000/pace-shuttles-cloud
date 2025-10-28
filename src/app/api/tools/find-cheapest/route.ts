// src/app/api/tools/find-cheapest/route.ts
// Find the cheapest upcoming journeys using the same SSOT quote engine as the homepage.
// Input (POST JSON):
//   {
//     country_id?: string,        // if omitted, searches all countries from /api/home-hydrate
//     destination_id?: string,
//     pickup_id?: string,
//     date_from?: "YYYY-MM-DD",   // default: tomorrow + lead time
//     date_to?:   "YYYY-MM-DD",   // default: +60 days
//     qty?: number,               // default: 2
//     limit?: number              // default: 5 (max 20)
//   }

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Country = { id: string; name: string; timezone?: string | null };
type Pickup  = { id: string; name: string; country_id: string };
type Dest    = { id: string; name: string; country_id: string | null };
type Vehicle = { id: string; active?: boolean | null; maxseats?: number | string | null; type_id?: string | null };
type Assignment = { id: string; route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null };
type RouteRow = {
  id: string;
  route_name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  pickup_time: string | null;   // "HH:mm"
  frequency: string | null;     // "Daily", "Every Tuesday", "Ad-hoc"
  season_from?: string | null;  // YYYY-MM-DD
  season_to?:   string | null;  // YYYY-MM-DD
  transport_type?: string | null;
  countries?: { id: string; name: string; timezone?: string | null } | null;
};

type HydrateGlobal = {
  countries: Country[];
  available_destinations_by_country: Record<string, string[]>;
};

type HydrateCountry = {
  pickups: Pickup[];
  destinations: Dest[];
  routes: RouteRow[];
  assignments: Assignment[];
  vehicles: Vehicle[];
};

type QuoteOk = {
  availability: "available" | "no_journey" | "no_vehicles" | "sold_out" | "insufficient_capacity_for_party";
  qty: number;
  total_cents: number;
  unit_cents?: number;
  currency?: string;
  vehicle_id?: string | null;
  max_qty_at_price?: number | null;
  token: string;
};

type QuoteErr = { error_code: string; details?: string; step?: string };

const MIN_LEAD_HOURS = 25;

function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }
function formatISODate(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString().slice(0,10);
}
function withinSeason(dayISO: string, from?: string | null, to?: string | null) {
  if (!from && !to) return true;
  return (!from || dayISO >= from) && (!to || dayISO <= to);
}
function parseFrequency(freq: string | null | undefined):
  { type: "DAILY" } | { type: "WEEKLY"; weekday: number } | { type: "ADHOC" } {
  if (!freq) return { type: "ADHOC" };
  const s = freq.toLowerCase();
  if (s.includes("daily")) return { type: "DAILY" };
  const names = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const i = names.findIndex(n => s.includes(n));
  return i >= 0 ? { type: "WEEKLY", weekday: i } : { type: "ADHOC" };
}

async function fetchJSON<T>(origin: string, path: string): Promise<T> {
  const res = await fetch(`${origin}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return (await res.json()) as T;
}

async function quote(origin: string, routeId: string, dateISO: string, qty: number, vehicleId?: string | null) {
  const sp = new URLSearchParams({
    route_id: routeId,
    date: dateISO,
    qty: String(Math.max(1, qty)),
    diag: process.env.NODE_ENV !== "production" ? "1" : "0",
  });
  if (vehicleId) sp.set("vehicle_id", vehicleId);
  const res = await fetch(`${origin}/api/quote?${sp.toString()}`, { cache: "no-store" });
  const body = await res.text();
  try { return JSON.parse(body) as QuoteOk | QuoteErr; }
  catch { return { error_code: `non_json_${res.status}`, details: body.slice(0, 160) } as QuoteErr; }
}

function generateDates(windowStartISO: string, windowEndISO: string, r: RouteRow): string[] {
  const out: string[] = [];
  const freq = parseFrequency(r.frequency);
  const start = new Date(`${windowStartISO}T12:00:00`);
  const end   = new Date(`${windowEndISO}T12:00:00`);
  if (freq.type === "DAILY") {
    for (let d = new Date(start); d <= end; d = addDays(d, 1))
      out.push(formatISODate(d));
  } else if (freq.type === "WEEKLY") {
    // align to weekday
    const s = new Date(start);
    const diff = (freq.weekday - s.getDay() + 7) % 7;
    s.setDate(s.getDate() + diff);
    for (let d = new Date(s); d <= end; d = addDays(d, 7))
      out.push(formatISODate(d));
  } else {
    // ADHOC: assume “today onward” available inside window
    out.push(formatISODate(start));
  }
  // season filter
  return out.filter(iso => withinSeason(iso, r.season_from ?? null, r.season_to ?? null));
}

export async function POST(req: Request) {
  try {
    const origin = new URL(req.url).origin;

    const body = await req.json().catch(() => ({}));
    const countryId = body.country_id ? String(body.country_id) : null;
    const destinationId = body.destination_id ? String(body.destination_id) : null;
    const pickupId = body.pickup_id ? String(body.pickup_id) : null;
    const qty = Math.max(1, Number(body.qty ?? 2));

    const limit = Math.min(20, Math.max(1, Number(body.limit ?? 5)));

    // Date window defaults
    const nowPlusLead = addDays(new Date(), 0);
    nowPlusLead.setHours(nowPlusLead.getHours() + MIN_LEAD_HOURS);
    const defaultFromISO = formatISODate(startOfDay(nowPlusLead));
    const defaultToISO = formatISODate(addDays(startOfDay(nowPlusLead), 60));
    const windowStartISO = (body.date_from as string) || defaultFromISO;
    const windowEndISO   = (body.date_to as string)   || defaultToISO;

    // Gather inventory from hydrate endpoints (reuse your homepage data model)
    const globals = await fetchJSON<HydrateGlobal>(origin, `/api/home-hydrate`);
    const countryIds = countryId ? [countryId] : Object.keys(globals.available_destinations_by_country);

    // Build candidate occurrences
    type Occ = { route: RouteRow; dateISO: string; vehicleIds: string[] };
    const occurrences: Occ[] = [];

    for (const cId of countryIds) {
      const data = await fetchJSON<HydrateCountry>(origin, `/api/home-hydrate?country_id=${encodeURIComponent(cId)}`);

      const activeVehicleIds = new Set(
        (data.vehicles ?? [])
          .filter(v => v && v.active !== false && Number(v.maxseats ?? 0) > 0)
          .map(v => v.id)
      );

      const routesWithActiveVehicle = new Map<string, string[]>();
      for (const a of (data.assignments ?? [])) {
        if (a.is_active === false) continue;
        if (activeVehicleIds.has(a.vehicle_id)) {
          const arr = routesWithActiveVehicle.get(a.route_id) ?? [];
          arr.push(a.vehicle_id);
          routesWithActiveVehicle.set(a.route_id, arr);
        }
      }

      for (const r of (data.routes ?? [])) {
        if (!routesWithActiveVehicle.has(r.id)) continue;

        // Optional filters
        if (destinationId && r.destination_id !== destinationId) continue;
        if (pickupId && r.pickup_id !== pickupId) continue;

        const dates = generateDates(windowStartISO, windowEndISO, r);
        const vIds = routesWithActiveVehicle.get(r.id)!;

        // Cap brute-force requests: only take the first ~15 dates per route to avoid explosion
        for (const d of dates.slice(0, 15)) {
          occurrences.push({ route: r, dateISO: d, vehicleIds: vIds });
        }
      }
    }

    // Quote each occurrence (try without pin first; if price comes back tied to a vehicle, use it)
    // Hard cap total quotes to avoid timeouts
    const HARD_CAP = 80;
    const toQuote = occurrences.slice(0, HARD_CAP);

    const quoted: Array<{
      route: RouteRow;
      dateISO: string;
      perSeatMinor: number;
      currency: string;
      token: string;
      vehicle_id: string | null;
      max_qty_at_price: number | null;
    }> = [];

    for (const occ of toQuote) {
      const q = await quote(origin, occ.route.id, occ.dateISO, qty);
      if ("error_code" in q) continue;
      if (q.availability === "sold_out" || q.availability === "no_journey" || q.availability === "no_vehicles") continue;

      const unitMinor =
        (q.unit_cents ?? null) != null
          ? Number(q.unit_cents)
          : Math.round(Number(q.total_cents ?? 0) / Math.max(1, Number(q.qty || 1)));

      quoted.push({
        route: occ.route,
        dateISO: occ.dateISO,
        perSeatMinor: unitMinor,
        currency: q.currency ?? "GBP",
        token: q.token,
        vehicle_id: q.vehicle_id ?? null,
        max_qty_at_price: q.max_qty_at_price ?? null,
      });
    }

    quoted.sort((a, b) => a.perSeatMinor - b.perSeatMinor);

    const results = quoted.slice(0, limit).map((q) => ({
      route_id: q.route.id,
      pickup_id: q.route.pickup_id,
      destination_id: q.route.destination_id,
      dateISO: q.dateISO,
      price_per_seat_gbp: Math.ceil(q.perSeatMinor / 100),
      currency: q.currency,
      quoteToken: q.token,
      vehicle_id: q.vehicle_id,
      max_qty_at_price: q.max_qty_at_price,
      // tiny summary for chat
      summary: `${q.route.route_name ?? "Journey"} on ${q.dateISO} — £${Math.ceil(q.perSeatMinor / 100)} per seat`,
    }));

    return NextResponse.json({
      results,
      meta: {
        searched_countries: countryIds.length,
        considered_occurrences: toQuote.length,
        returned: results.length,
        qty,
        window: { from: windowStartISO, to: windowEndISO },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "find-cheapest failed" },
      { status: 500 }
    );
  }
}
