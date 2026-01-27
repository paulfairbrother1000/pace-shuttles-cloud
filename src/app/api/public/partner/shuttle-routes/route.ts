import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const WINDOW_DAYS = 60;
const MIN_LEAD_HOURS = 25;

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function safeEqualHex(a: string, b: string) {
  // constant-time compare
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
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
  x.setHours(12, 0, 0, 0);
  return x;
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

type Freq = { type: "WEEKLY"; weekday: number } | { type: "DAILY" } | { type: "ADHOC" };
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function parseFrequency(freq: string | null | undefined): Freq {
  if (!freq) return { type: "ADHOC" };
  const s = (freq || "").toLowerCase().trim();
  if (s.includes("daily")) return { type: "DAILY" };
  const weekdayIdx = DAY_NAMES.findIndex((d) => s.includes(d.toLowerCase()));
  if (weekdayIdx >= 0) return { type: "WEEKLY", weekday: weekdayIdx };
  return { type: "ADHOC" };
}

// Mirrors your homepage rounding behaviour
function unitMinorToDisplayMajorCeil(unitMinor: number) {
  return Math.ceil(unitMinor / 100);
}

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
  cheapest: null | {
    unit_minor: number;
    currency: string;
    display_major_rounded_up: number;
    applies_to: { date_iso: string; pickup_time: string | null };
    max_qty_at_price?: number | null;
  };
};

export async function GET(req: Request) {
  try {
    const { searchParams, origin } = new URL(req.url);

    const operatorId = searchParams.get("operator_id")?.trim();
    const operatorKey = req.headers.get("x-operator-key")?.trim();

    if (!operatorId) {
      return NextResponse.json({ error: "Missing operator_id" }, { status: 400 });
    }
    if (!operatorKey) {
      return NextResponse.json({ error: "Missing x-operator-key" }, { status: 401 });
    }

    // Use service role on server routes (never expose to client)
    const supabase = createClient(
      must("SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    // 1) Fetch operator and validate key hash
    const { data: operator, error: opErr } = await supabase
      .from("operators")
      .select("id, country_id, partner_api_key_hash")
      .eq("id", operatorId)
      .maybeSingle();

    if (opErr || !operator) {
      return NextResponse.json({ error: "Invalid operator_id" }, { status: 401 });
    }
    if (!operator.partner_api_key_hash) {
      return NextResponse.json({ error: "Operator not enabled for partner API" }, { status: 403 });
    }

    const providedHash = sha256Hex(operatorKey);
    if (!safeEqualHex(providedHash, operator.partner_api_key_hash)) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    if (!operator.country_id) {
      return NextResponse.json({ error: "Operator has no country_id" }, { status: 409 });
    }

    // 2) Derive operator vehicle type (must be 1:1)
    // This assumes you have:
    // - vehicles table with operator_id, type_id, active, maxseats
    // - transport_types table with id, name
    const { data: opVehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active")
      .eq("operator_id", operatorId)
      .neq("active", false);

    if (vErr) throw vErr;
    const typeIds = Array.from(new Set((opVehicles ?? []).map(v => v.type_id).filter(Boolean))) as string[];

    if (typeIds.length !== 1) {
      return NextResponse.json(
        { error: "Operator vehicle type is not 1:1. Expected exactly one type_id for operator vehicles.", typeIds },
        { status: 409 }
      );
    }
    const operatorTypeId = typeIds[0];

    const { data: ttype, error: tErr } = await supabase
      .from("transport_types")
      .select("id, name")
      .eq("id", operatorTypeId)
      .maybeSingle();

    if (tErr || !ttype?.name) {
      return NextResponse.json({ error: "Could not derive operator vehicle type name" }, { status: 500 });
    }
    const vehicleTypeName = ttype.name;

    // 3) Fetch country name
    const { data: country, error: cErr } = await supabase
      .from("countries")
      .select("id, name, timezone")
      .eq("id", operator.country_id)
      .maybeSingle();

    if (cErr || !country?.name) {
      return NextResponse.json({ error: "Could not load operator country" }, { status: 500 });
    }

    // 4) Identify candidate routes for that country + that transport type
    // We mirror your homepage’s “verifiedRoutes”: must have active assignment to active vehicle with capacity
    const { data: routes, error: rErr } = await supabase
      .from("routes")
      .select(`
        id,
        route_name,
        country_id,
        pickup_id,
        destination_id,
        pickup_time,
        frequency,
        season_from,
        season_to,
        is_active,
        transport_type
      `)
      .eq("country_id", operator.country_id)
      .neq("is_active", false);

    if (rErr) throw rErr;

    const routeIds = (routes ?? []).map(r => r.id);
    if (!routeIds.length) return NextResponse.json({ tiles: [] });

    const { data: assignments, error: aErr } = await supabase
      .from("assignments")
      .select("route_id, vehicle_id, is_active")
      .in("route_id", routeIds)
      .neq("is_active", false);

    if (aErr) throw aErr;

    const assignedVehicleIds = Array.from(new Set((assignments ?? []).map(a => a.vehicle_id).filter(Boolean))) as string[];

    const { data: assignedVehicles, error: avErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active, maxseats")
      .in("id", assignedVehicleIds)
      .neq("active", false);

    if (avErr) throw avErr;

    const activeCapacityVehicleIds = new Set(
      (assignedVehicles ?? [])
        .filter(v => (v.type_id === operatorTypeId) && Number(v.maxseats ?? 0) > 0)
        .map(v => v.id)
    );

    const routesWithActiveVehicle = new Set<string>();
    for (const a of assignments ?? []) {
      if (activeCapacityVehicleIds.has(a.vehicle_id)) routesWithActiveVehicle.add(a.route_id);
    }

    const candidateRoutes = (routes ?? []).filter(r => routesWithActiveVehicle.has(r.id));

    // 5) Fetch pickups + destinations for those routes
    const pickupIds = Array.from(new Set(candidateRoutes.map(r => r.pickup_id).filter(Boolean))) as string[];
    const destIds = Array.from(new Set(candidateRoutes.map(r => r.destination_id).filter(Boolean))) as string[];

const [{ data: pickups, error: pErr }, { data: destinations, error: dErr }] = await Promise.all([
  supabase.from("pickup_points").select("id, name, picture_url").in("id", pickupIds),
  supabase.from("destinations").select("id, name, picture_url").in("id", destIds),
]);

    if (pErr) throw pErr;
    if (dErr) throw dErr;

    const pickupById = new Map((pickups ?? []).map(p => [p.id, p]));
    const destById = new Map((destinations ?? []).map(d => [d.id, d]));

    // 6) Scan occurrences and find cheapest via /api/quote (qty=1)
    const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
    const minDay = startOfDay(nowPlus25h);
    const maxDay = addDays(minDay, WINDOW_DAYS);

    async function quoteUnitMinor(routeId: string, dateISO: string): Promise<null | { unitMinor: number; currency: string; max_qty_at_price?: number | null }> {
      const sp = new URLSearchParams({
        route_id: routeId,
        date: dateISO,
        qty: "1",
        diag: "0",
      });

      const res = await fetch(`${origin}/api/quote?${sp.toString()}`, { cache: "no-store" });
      if (!res.ok) return null;

      const json = (await res.json().catch(() => null)) as QuoteOk | null;
      if (!json || (json.availability !== "available")) return null;

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

    // throttle quotes so we don’t hammer /api/quote
    async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
      const out: R[] = [];
      let i = 0;
      const workers = Array.from({ length: Math.max(1, limit) }, async () => {
        while (i < items.length) {
          const idx = i++;
          out[idx] = await fn(items[idx]);
        }
      });
      await Promise.all(workers);
      return out;
    }

    function toISO(d: Date) {
      return d.toISOString().slice(0, 10);
    }

    const tiles: Tile[] = [];

    for (const r of candidateRoutes) {
      const pu = r.pickup_id ? pickupById.get(r.pickup_id) : null;
      const de = r.destination_id ? destById.get(r.destination_id) : null;

      const pickupName = pu?.name ?? "—";
      const destName = de?.name ?? "—";
      const routeName = (r.route_name && r.route_name.trim()) ? r.route_name : `${pickupName} to ${destName}`;

      // generate dates
      const kind = parseFrequency(r.frequency);
      const dates: string[] = [];

      if (kind.type === "DAILY") {
        for (let d = new Date(minDay); d <= maxDay; d = addDays(d, 1)) {
          if (!withinSeason(d, r.season_from, r.season_to)) continue;
          dates.push(toISO(d));
        }
      } else if (kind.type === "WEEKLY") {
        // next matching weekday from minDay
        const start = new Date(minDay);
        const diff = (kind.weekday - start.getDay() + 7) % 7;
        start.setDate(start.getDate() + diff);
        for (let d = new Date(start); d <= maxDay; d = addDays(d, 7)) {
          if (!withinSeason(d, r.season_from, r.season_to)) continue;
          dates.push(toISO(d));
        }
      } else {
        // ADHOC: only consider first bookable day (minDay) if in season
        if (withinSeason(minDay, r.season_from, r.season_to)) {
          dates.push(toISO(minDay));
        }
      }

      // Call quote for these dates and take min
      const quotes = await mapWithConcurrency(dates, 6, async (dateISO) => {
        const q = await quoteUnitMinor(r.id, dateISO);
        return { dateISO, q };
      });

      let best: { dateISO: string; unitMinor: number; currency: string; max_qty_at_price?: number | null } | null = null;
      for (const item of quotes) {
        if (!item.q) continue;
        if (!best || item.q.unitMinor < best.unitMinor) {
          best = { dateISO: item.dateISO, unitMinor: item.q.unitMinor, currency: item.q.currency, max_qty_at_price: item.q.max_qty_at_price };
        }
      }

      tiles.push({
        route_id: r.id,
        country: country.name,
        vehicle_type: vehicleTypeName,
        route_name: routeName,
        pickup: { id: r.pickup_id ?? "", name: pickupName, image_url: pu?.picture_url ?? null },
        destination: { id: r.destination_id ?? "", name: destName, image_url: de?.picture_url ?? null },
        schedule: r.frequency ?? null,
        cheapest: best
          ? {
              unit_minor: best.unitMinor,
              currency: best.currency,
              display_major_rounded_up: unitMinorToDisplayMajorCeil(best.unitMinor),
              applies_to: { date_iso: best.dateISO, pickup_time: r.pickup_time ?? null },
              max_qty_at_price: best.max_qty_at_price ?? null,
            }
          : null,
      });
    }

    // sort cheapest first (nulls last)
    tiles.sort((a, b) => {
      const aa = a.cheapest?.unit_minor ?? Number.POSITIVE_INFINITY;
      const bb = b.cheapest?.unit_minor ?? Number.POSITIVE_INFINITY;
      return aa - bb;
    });

    return NextResponse.json({ tiles });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
