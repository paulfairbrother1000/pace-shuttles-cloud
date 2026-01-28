// src/app/api/public/partner/shuttle-routes/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePartnerOperator } from "@/lib/partnerAuth";

export const runtime = "nodejs";

const WINDOW_DAYS = 60;
const MIN_LEAD_HOURS = 25;

// bump this whenever you deploy, so you can see production is running the right build
const BUILD_TAG = "partner_shuttle_routes_v7_vehicle_type_from_journey_types";

/* ---------------- helpers ---------------- */
function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function addHours(d: Date, n: number) {
  const x = new Date(d);
  x.setHours(x.getHours() + n);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  // match Pace Shuttles home page logic (midday anchor)
  x.setHours(12, 0, 0, 0);
  return x;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function unitMinorToDisplayMajorCeil(unitMinor: number) {
  // Mirrors your homepage rounding behaviour
  return Math.ceil(unitMinor / 100);
}

function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) {
    const f = new Date(from + "T12:00:00").getTime();
    if (t < f) return false;
  }
  if (to) {
    const tt = new Date(to + "T12:00:00").getTime();
    if (t > tt) return false;
  }
  return true;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Freq = { type: "WEEKLY"; weekday: number } | { type: "DAILY" } | { type: "ADHOC" };
function parseFrequency(freq: string | null | undefined): Freq {
  if (!freq) return { type: "ADHOC" };
  const s = (freq || "").toLowerCase().trim();
  if (s.includes("daily")) return { type: "DAILY" };
  const weekdayIdx = DAY_NAMES.findIndex((d) => s.includes(d.toLowerCase()));
  if (weekdayIdx >= 0) return { type: "WEEKLY", weekday: weekdayIdx };
  return { type: "ADHOC" };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
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

/* ---------------- types ---------------- */
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
  vehicle_type: string; // plain-English (from journey_types.name)
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;
    const origin = url.origin;

    const operatorId = searchParams.get("operator_id")?.trim();
    if (!operatorId) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Missing operator_id" }, { status: 400 });
    }

    // Auth: uses x-operator-key, checks against operators.partner_api_key_hash
    // (this helper should already return appropriate 401/403 responses)
    const auth = await requirePartnerOperator(req, operatorId);
    if ("response" in auth) return auth.response;

    // Create server-side supabase client
    const supabase = createClient(must("SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // Operator record (for country)
    const { data: operator, error: opErr } = await supabase
      .from("operators")
      .select("id, country_id")
      .eq("id", operatorId)
      .maybeSingle();

    if (opErr || !operator) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Invalid operator_id" }, { status: 401 });
    }
    if (!operator.country_id) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Operator has no country_id" }, { status: 409 });
    }

    // Country name
    const { data: countryRow, error: cErr } = await supabase
      .from("countries")
      .select("id, name")
      .eq("id", operator.country_id)
      .maybeSingle();

    if (cErr || !countryRow?.name) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Could not load operator country" }, { status: 500 });
    }
    const countryName = countryRow.name;

    // 1) Fetch routes for operator country (active only)
    const { data: routes, error: rErr } = await supabase
      .from("routes")
      .select(
        "id, route_name, pickup_id, destination_id, pickup_time, frequency, season_from, season_to, is_active, journey_type_id"
      )
      .eq("country_id", operator.country_id)
      .neq("is_active", false);

    if (rErr) throw rErr;

    const routeIds = (routes ?? []).map((r: any) => r.id);
    if (!routeIds.length) {
      return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });
    }

    // 2) Only include routes that have ACTIVE RVAs pointing to ACTIVE vehicles with capacity > 0
    const { data: rvas, error: aErr } = await supabase
      .from("route_vehicle_assignments")
      .select("route_id, vehicle_id, is_active")
      .in("route_id", routeIds)
      .eq("is_active", true);

    if (aErr) throw aErr;

    const assignedVehicleIds = Array.from(new Set((rvas ?? []).map((a: any) => a.vehicle_id).filter(Boolean))) as string[];
    if (!assignedVehicleIds.length) {
      return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });
    }

    const { data: vehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id, active, maxseats")
      .in("id", assignedVehicleIds)
      .eq("active", true);

    if (vErr) throw vErr;

    const activeCapacityVehicleIds = new Set(
      (vehicles ?? []).filter((v: any) => Number(v.maxseats ?? 0) > 0).map((v: any) => v.id)
    );

    const routesWithActiveVehicle = new Set<string>();
    for (const a of rvas ?? []) {
      if (activeCapacityVehicleIds.has((a as any).vehicle_id)) routesWithActiveVehicle.add((a as any).route_id);
    }

    const candidateRoutes = (routes ?? []).filter((r: any) => routesWithActiveVehicle.has(r.id));
    if (!candidateRoutes.length) {
      return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });
    }

    // 3) Vehicle type: derive from routes.journey_type_id -> journey_types.name (plain English)
    const journeyTypeIds = Array.from(
      new Set(candidateRoutes.map((r: any) => r.journey_type_id).filter(Boolean))
    ) as string[];

    const { data: journeyTypes, error: jtErr } = await supabase
      .from("journey_types")
      .select("id, name")
      .in("id", journeyTypeIds);

    if (jtErr) throw jtErr;

    const journeyTypeById = new Map<string, string>((journeyTypes ?? []).map((jt: any) => [jt.id, jt.name]));

    // 4) Fetch pickups + destinations (minimal fields for tiles)
    const pickupIds = Array.from(new Set(candidateRoutes.map((r: any) => r.pickup_id).filter(Boolean))) as string[];
    const destIds = Array.from(new Set(candidateRoutes.map((r: any) => r.destination_id).filter(Boolean))) as string[];

    const [{ data: pickups, error: pErr }, { data: destinations, error: dErr }] = await Promise.all([
      supabase.from("pickup_points").select("id, name, picture_url, active").in("id", pickupIds),
      supabase.from("destinations").select("id, name, picture_url").in("id", destIds),
    ]);

    if (pErr) throw pErr;
    if (dErr) throw dErr;

    // pickup_points has active flag; only map active records (avoid broken drilldowns)
    const pickupById = new Map(
      (pickups ?? [])
        .filter((p: any) => p.active !== false)
        .map((p: any) => [p.id, { id: p.id, name: p.name, picture_url: p.picture_url ?? null }])
    );
    const destById = new Map((destinations ?? []).map((d: any) => [d.id, d]));

    // 5) Scan occurrences and find cheapest via /api/quote (qty=1)
    const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
    const minDay = startOfDay(nowPlus25h);
    const maxDay = addDays(minDay, WINDOW_DAYS);

    async function quoteUnitMinor(
      routeId: string,
      dateISO: string
    ): Promise<null | { unitMinor: number; currency: string; max_qty_at_price?: number | null }> {
      const sp = new URLSearchParams({
        route_id: routeId,
        date: dateISO,
        qty: "1",
        diag: "0",
      });

      const res = await fetch(`${origin}/api/quote?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) return null;

      const json = (await res.json().catch(() => null)) as QuoteOk | null;
      if (!json || json.availability !== "available") return null;

      const unitMinor =
        json.unit_cents != null
          ? Number(json.unit_cents)
          : Math.round(Number(json.total_cents ?? 0) / Math.max(1, Number(json.qty ?? 1)));

      if (!Number.isFinite(unitMinor) || unitMinor <= 0) return null;

      return {
        unitMinor,
        currency: json.currency ?? "GBP",
        max_qty_at_price: json.max_qty_at_price ?? null,
      };
    }

    const tiles: Tile[] = [];

    for (const r of candidateRoutes as any[]) {
      // Guard: must have pickup+destination to render tiles sanely
      const pu = r.pickup_id ? pickupById.get(r.pickup_id) : null;
      const de = r.destination_id ? destById.get(r.destination_id) : null;
      if (!pu || !de) continue;

      const pickupName = pu?.name ?? "—";
      const destName = de?.name ?? "—";

      const routeName =
        r.route_name && String(r.route_name).trim() ? String(r.route_name) : `${pickupName} → ${destName}`;

      const schedule = r.frequency ?? null;

      const vehicleTypeName =
        (r.journey_type_id && journeyTypeById.get(r.journey_type_id)) ||
        "Unknown";

      // Build occurrence dates within the window (>= 25h lead time), per frequency+season
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
        // ADHOC: only consider first bookable day (minDay) if in season
        if (withinSeason(minDay, r.season_from, r.season_to)) dates.push(iso(minDay));
      }

      if (!dates.length) continue;

      // Quote all candidate dates (limited concurrency) and select the minimum available unit price
      const quotes = await mapWithConcurrency(dates, 6, async (dateISO) => {
        const q = await quoteUnitMinor(r.id, dateISO);
        return { dateISO, q };
      });

      let best: { dateISO: string; unitMinor: number; currency: string; max_qty_at_price?: number | null } | null = null;
      for (const item of quotes as any[]) {
        if (!item.q) continue;
        if (!best || item.q.unitMinor < best.unitMinor) {
          best = {
            dateISO: item.dateISO,
            unitMinor: item.q.unitMinor,
            currency: item.q.currency,
            max_qty_at_price: item.q.max_qty_at_price,
          };
        }
      }

      // Marketing tiles: only include routes that have at least one *bookable priced* departure in the window
      if (!best) continue;

      tiles.push({
        route_id: r.id,
        country: countryName,
        vehicle_type: vehicleTypeName,
        route_name: routeName,
        pickup: { id: r.pickup_id ?? "", name: pickupName, image_url: pu?.picture_url ?? null },
        destination: { id: r.destination_id ?? "", name: destName, image_url: de?.picture_url ?? null },
        schedule,
        cheapest: {
          unit_minor: best.unitMinor,
          currency: best.currency,
          display_major_rounded_up: unitMinorToDisplayMajorCeil(best.unitMinor),
          applies_to: { date_iso: best.dateISO, pickup_time: r.pickup_time ?? null },
          max_qty_at_price: best.max_qty_at_price ?? null,
        },
      });
    }

    // sort by cheapest first
    tiles.sort((a, b) => (a.cheapest?.unit_minor ?? 9e15) - (b.cheapest?.unit_minor ?? 9e15));

    return NextResponse.json({ build_tag: BUILD_TAG, tiles });
  } catch (e: any) {
    return NextResponse.json({ build_tag: BUILD_TAG, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
