import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePartnerOperator } from "@/lib/partnerAuth";

export const runtime = "nodejs";

const WINDOW_DAYS = 60;
const MIN_LEAD_HOURS = 25;

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function addHours(d: Date, n: number) { const x = new Date(d); x.setHours(x.getHours() + n); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }

function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) { const f = new Date(from + "T12:00:00").getTime(); if (t < f) return false; }
  if (to)   { const tt = new Date(to + "T12:00:00").getTime(); if (t > tt) return false; }
  return true;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
type Freq = { type: "WEEKLY"; weekday: number } | { type: "DAILY" } | { type: "ADHOC" };
function parseFrequency(freq: string | null | undefined): Freq {
  if (!freq) return { type: "ADHOC" };
  const s = (freq || "").toLowerCase().trim();
  if (s.includes("daily")) return { type: "DAILY" };
  const weekdayIdx = DAY_NAMES.findIndex((d) => s.includes(d.toLowerCase()));
  if (weekdayIdx >= 0) return { type: "WEEKLY", weekday: weekdayIdx };
  return { type: "ADHOC" };
}

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function unitMinorToDisplayMajorCeil(unitMinor: number) { return Math.ceil(unitMinor / 100); }

type QuoteOk = {
  availability: "available" | "no_journey" | "no_vehicles" | "sold_out" | "insufficient_capacity_for_party";
  qty: number;
  total_cents: number;
  unit_cents?: number;
  currency?: string;
  max_qty_at_price?: number | null;
};

type Tile = {
  route_id: string;
  country: string;
  vehicle_type: string;
  route_name: string;
  pickup: { id: string; name: string; image_url: string | null };
  destination: { id: string; name: string; image_url: string | null };
  schedule: string | null;
  cheapest: {
    unit_minor: number;
    currency: string;
    display_major_rounded_up: number;
    applies_to: { date_iso: string; pickup_time: string | null };
    max_qty_at_price?: number | null;
  };
};

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET(req: Request) {
  try {
    const operator = await requirePartnerOperator(req);
    if (!operator.country_id) {
      return NextResponse.json({ tiles: [], note: "Operator has no country_id" }, { status: 200 });
    }

    const origin = new URL(req.url).origin;

    const supabase = createClient(
      must("SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // Derive operator vehicle type from vehicles (1:1 expected)
    const { data: opVehicles, error: opVehErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active")
      .eq("operator_id", operator.id)
      .neq("active", false);

    if (opVehErr) throw opVehErr;

    const typeIds = Array.from(new Set((opVehicles ?? []).map(v => v.type_id).filter(Boolean))) as string[];
    if (typeIds.length !== 1) {
      return NextResponse.json(
        { tiles: [], error: "Operator vehicle type is not 1:1 (expected exactly one vehicles.type_id).", typeIds },
        { status: 409 }
      );
    }
    const operatorTypeId = typeIds[0];

    const { data: vehicleTypeRow } = await supabase
      .from("transport_types")
      .select("id, name")
      .eq("id", operatorTypeId)
      .maybeSingle();

    const vehicleTypeName = vehicleTypeRow?.name ?? "—";

    // Country name
    const { data: countryRow } = await supabase
      .from("countries")
      .select("id, name")
      .eq("id", operator.country_id)
      .maybeSingle();

    const countryName = countryRow?.name ?? "—";

    // Load candidate routes in the operator country
    const { data: routes, error: rErr } = await supabase
      .from("routes")
      .select("id, route_name, country_id, pickup_id, destination_id, pickup_time, frequency, season_from, season_to, is_active")
      .eq("country_id", operator.country_id)
      .neq("is_active", false);

    if (rErr) throw rErr;

    const routeIds = (routes ?? []).map(r => r.id);
    if (!routeIds.length) return NextResponse.json({ tiles: [] });

    // Load assignments + vehicles to implement “journeys only” filter:
    // must have active assignment to an active vehicle with capacity (>0) AND vehicle type matches operatorTypeId
    const { data: assignments, error: aErr } = await supabase
      .from("assignments")
      .select("route_id, vehicle_id, is_active")
      .in("route_id", routeIds)
      .neq("is_active", false);

    if (aErr) throw aErr;

    const vehicleIds = Array.from(new Set((assignments ?? []).map(a => a.vehicle_id).filter(Boolean))) as string[];
    if (!vehicleIds.length) return NextResponse.json({ tiles: [] });

    const { data: vehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active, maxseats")
      .in("id", vehicleIds)
      .neq("active", false);

    if (vErr) throw vErr;

    const eligibleVehicleIds = new Set(
      (vehicles ?? [])
        .filter(v => v.type_id === operatorTypeId && Number(v.maxseats ?? 0) > 0)
        .map(v => v.id)
    );

    const routesWithEligibleVehicles = new Set<string>();
    for (const a of assignments ?? []) {
      if (eligibleVehicleIds.has(a.vehicle_id)) routesWithEligibleVehicles.add(a.route_id);
    }

    const journeyRoutes = (routes ?? []).filter(r => routesWithEligibleVehicles.has(r.id));
    if (!journeyRoutes.length) return NextResponse.json({ tiles: [] });

    // pickups/destinations
    const pickupIds = Array.from(new Set(journeyRoutes.map(r => r.pickup_id).filter(Boolean))) as string[];
    const destIds = Array.from(new Set(journeyRoutes.map(r => r.destination_id).filter(Boolean))) as string[];

    const [{ data: pickups, error: pErr }, { data: destinations, error: dErr }] = await Promise.all([
      supabase.from("pickups").select("id, name, picture_url").in("id", pickupIds),
      supabase.from("destinations").select("id, name, picture_url").in("id", destIds),
    ]);
    if (pErr) throw pErr;
    if (dErr) throw dErr;

    const pickupById = new Map((pickups ?? []).map(p => [p.id, p]));
    const destById = new Map((destinations ?? []).map(d => [d.id, d]));

    // Quote helper: qty=1 “bookable now”
    async function quoteUnitMinor(routeId: string, dateISO: string) {
      const sp = new URLSearchParams({ route_id: routeId, date: dateISO, qty: "1", diag: "0" });
      const res = await fetch(`${origin}/api/quote?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as QuoteOk | null;
      if (!json || json.availability !== "available") return null;

      const unitMinor =
        (json.unit_cents != null)
          ? Number(json.unit_cents)
          : Math.round(Number(json.total_cents ?? 0) / Math.max(1, Number(json.qty ?? 1)));

      if (!Number.isFinite(unitMinor) || unitMinor <= 0) return null;

      return {
        unitMinor,
        currency: json.currency ?? "GBP",
        max_qty_at_price: json.max_qty_at_price ?? null,
      };
    }

    // Date window: next 60 days, >25 hours
    const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
    const minDay = startOfDay(nowPlus25h);
    const maxDay = addDays(minDay, WINDOW_DAYS);

    const tiles: Tile[] = [];

    for (const r of journeyRoutes) {
      const pu = r.pickup_id ? pickupById.get(r.pickup_id) : null;
      const de = r.destination_id ? destById.get(r.destination_id) : null;

      const pickupName = pu?.name ?? "—";
      const destName = de?.name ?? "—";
      const routeName = (r.route_name && r.route_name.trim()) ? r.route_name : `${pickupName} to ${destName}`;

      // Build occurrence dates
      const kind = parseFrequency(r.frequency);
      const dates: string[] = [];

      if (kind.type === "DAILY") {
        for (let d = new Date(minDay); d <= maxDay; d = addDays(d, 1)) {
          if (!withinSeason(d, r.season_from, r.season_to)) continue;
          dates.push(iso(d));
        }
      } else if (kind.type === "WEEKLY") {
        const start = new Date(minDay);
        const diff = (kind.weekday - start.getDay() + 7) % 7;
        start.setDate(start.getDate() + diff);
        for (let d = new Date(start); d <= maxDay; d = addDays(d, 7)) {
          if (!withinSeason(d, r.season_from, r.season_to)) continue;
          dates.push(iso(d));
        }
      } else {
        if (withinSeason(minDay, r.season_from, r.season_to)) dates.push(iso(minDay));
      }

      if (!dates.length) continue;

      // Quote all candidate dates (throttled), pick min
      const quoted = await mapWithConcurrency(dates, 6, async (dateISO) => {
        const q = await quoteUnitMinor(r.id, dateISO);
        return { dateISO, q };
      });

      let best: { dateISO: string; unitMinor: number; currency: string; max_qty_at_price?: number | null } | null = null;
      for (const item of quoted) {
        if (!item.q) continue;
        if (!best || item.q.unitMinor < best.unitMinor) {
          best = { dateISO: item.dateISO, unitMinor: item.q.unitMinor, currency: item.q.currency, max_qty_at_price: item.q.max_qty_at_price };
        }
      }

      // IMPORTANT: only include “journeys” that are actually bookable/priced in window
      if (!best) continue;

      tiles.push({
        route_id: r.id,
        country: countryName,
        vehicle_type: vehicleTypeName,
        route_name: routeName,
        pickup: { id: r.pickup_id ?? "", name: pickupName, image_url: pu?.picture_url ?? null },
        destination: { id: r.destination_id ?? "", name: destName, image_url: de?.picture_url ?? null },
        schedule: r.frequency ?? null,
        cheapest: {
          unit_minor: best.unitMinor,
          currency: best.currency,
          display_major_rounded_up: unitMinorToDisplayMajorCeil(best.unitMinor),
          applies_to: { date_iso: best.dateISO, pickup_time: r.pickup_time ?? null },
          max_qty_at_price: best.max_qty_at_price ?? null,
        },
      });
    }

    // sort by cheapest
    tiles.sort((a, b) => a.cheapest.unit_minor - b.cheapest.unit_minor);

    return NextResponse.json({ tiles });
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status });
  }
}
