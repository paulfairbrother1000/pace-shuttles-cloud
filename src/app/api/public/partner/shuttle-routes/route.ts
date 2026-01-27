// src/app/api/public/partner/shuttle-routes/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePartnerOperator } from "@/lib/partnerAuth";

export const runtime = "nodejs";

const WINDOW_DAYS = 60;
const MIN_LEAD_HOURS = 25;

// bump this whenever you deploy, so you can see production is running the right build
const BUILD_TAG = "partner_shuttle_routes_v5_fix_origin_dupes";

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

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
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
  cheapest: {
    unit_minor: number;
    currency: string;
    display_major_rounded_up: number;
    applies_to: { date_iso: string; pickup_time: string | null };
    max_qty_at_price?: number | null;
  };
};

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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const searchParams = url.searchParams;
    const reqOrigin = url.origin;

    const operatorId = searchParams.get("operator_id")?.trim();
    const operatorKey = req.headers.get("x-operator-key")?.trim();

    if (!operatorId) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Missing operator_id" }, { status: 400 });
    }
    if (!operatorKey) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Missing x-operator-key" }, { status: 401 });
    }

    // If you later decide to move auth into lib/partnerAuth, keep this call.
    // For now, we don't rely on it to avoid double-auth logic.
    // await requirePartnerOperator(req);

    const supabase = createClient(must("SUPABASE_URL"), must("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // 1) Fetch operator and validate key hash
    const { data: operator, error: opErr } = await supabase
      .from("operators")
      .select("id, country_id, partner_api_key_hash")
      .eq("id", operatorId)
      .maybeSingle();

    if (opErr || !operator) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Invalid operator_id" }, { status: 401 });
    }
    if (!operator.partner_api_key_hash) {
      return NextResponse.json(
        { build_tag: BUILD_TAG, error: "Operator not enabled for partner API" },
        { status: 403 }
      );
    }

    // Use shared helper to validate key (consistent across partner endpoints)
    const auth = requirePartnerOperator
      ? await requirePartnerOperator({
          operatorId,
          operatorKey,
          supabase,
          expectedHash: operator.partner_api_key_hash,
        } as any).catch(() => null)
      : null;

    // If requirePartnerOperator isn't implemented in that shape, fall back to inline compare
    if (!auth) {
      // Inline fallback (sha256Hex + timing-safe compare) without importing crypto here.
      // We store hash as hex in DB, so compare using SubtleCrypto if available (node 20+).
      const enc = new TextEncoder();
      const data = enc.encode(operatorKey);
      const hashBuf = await crypto.subtle.digest("SHA-256", data);
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (hashHex !== operator.partner_api_key_hash) {
        return NextResponse.json({ build_tag: BUILD_TAG, error: "Unauthorised" }, { status: 401 });
      }
    }

    if (!operator.country_id) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Operator has no country_id" }, { status: 409 });
    }

    // 2) Derive operator vehicle type (must be 1:1)
    const { data: opVehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active")
      .eq("operator_id", operator.id)
      .neq("active", false);

    if (vErr) throw vErr;

    const typeIds = Array.from(new Set((opVehicles ?? []).map((v: any) => v.type_id).filter(Boolean))) as string[];
    if (typeIds.length !== 1) {
      return NextResponse.json(
        {
          build_tag: BUILD_TAG,
          error: "Operator vehicle type is not 1:1. Expected exactly one type_id for operator vehicles.",
          typeIds,
        },
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
      return NextResponse.json(
        { build_tag: BUILD_TAG, error: "Could not derive operator vehicle type name" },
        { status: 500 }
      );
    }
    const vehicleTypeName = ttype.name;

    // 3) Country name
    const { data: country, error: cErr } = await supabase
      .from("countries")
      .select("id, name")
      .eq("id", operator.country_id)
      .maybeSingle();

    if (cErr || !country?.name) {
      return NextResponse.json({ build_tag: BUILD_TAG, error: "Could not load operator country" }, { status: 500 });
    }
    const countryName = country.name;

    // 4) Candidate routes for that country (we will later filter to those with eligible vehicles)
    const { data: routes, error: rErr } = await supabase
      .from("routes")
      .select("id, route_name, country_id, pickup_id, destination_id, pickup_time, frequency, season_from, season_to, is_active")
      .eq("country_id", operator.country_id)
      .neq("is_active", false);

    if (rErr) throw rErr;

    const routeIds = (routes ?? []).map((r: any) => r.id);
    if (!routeIds.length) return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });

    // IMPORTANT: in this DB the table is route_vehicle_assignments (not assignments)
    const { data: rva, error: aErr } = await supabase
      .from("route_vehicle_assignments")
      .select("route_id, vehicle_id, is_active")
      .in("route_id", routeIds)
      .neq("is_active", false);

    if (aErr) throw aErr;

    const assignedVehicleIds = Array.from(new Set((rva ?? []).map((a: any) => a.vehicle_id).filter(Boolean))) as string[];
    if (!assignedVehicleIds.length) return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });

    const { data: assignedVehicles, error: avErr } = await supabase
      .from("vehicles")
      .select("id, type_id, active, maxseats")
      .in("id", assignedVehicleIds)
      .neq("active", false);

    if (avErr) throw avErr;

    const eligibleVehicleIds = new Set(
      (assignedVehicles ?? [])
        .filter((v: any) => v.type_id === operatorTypeId && Number(v.maxseats ?? 0) > 0)
        .map((v: any) => v.id)
    );

    const routesWithEligibleVehicles = new Set<string>();
    for (const a of rva ?? []) {
      const vid = (a as any).vehicle_id;
      const rid = (a as any).route_id;
      if (eligibleVehicleIds.has(vid)) routesWithEligibleVehicles.add(rid);
    }

    const candidateRoutes = (routes ?? []).filter((r: any) => routesWithEligibleVehicles.has(r.id));
    if (!candidateRoutes.length) return NextResponse.json({ build_tag: BUILD_TAG, tiles: [] });

    // 5) Fetch pickups + destinations for those routes
    const pickupIds = Array.from(new Set(candidateRoutes.map((r: any) => r.pickup_id).filter(Boolean))) as string[];
    const destIds = Array.from(new Set(candidateRoutes.map((r: any) => r.destination_id).filter(Boolean))) as string[];

    // IMPORTANT: pickups are pickup_points (not pickups)
    const [{ data: pickups, error: pErr }, { data: destinations, error: dErr }] = await Promise.all([
      pickupIds.length
        ? supabase.from("pickup_points").select("id, name, picture_url").in("id", pickupIds).eq("active", true)
        : Promise.resolve({ data: [], error: null } as any),
      destIds.length
        ? supabase.from("destinations").select("id, name, picture_url").in("id", destIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (pErr) throw pErr;
    if (dErr) throw dErr;

    const pickupById = new Map((pickups ?? []).map((p: any) => [p.id, p]));
    const destById = new Map((destinations ?? []).map((d: any) => [d.id, d]));

    // 6) Scan occurrences and find cheapest via /api/quote (qty=1)
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

      const res = await fetch(`${reqOrigin}/api/quote?${sp.toString()}`, { cache: "no-store" });
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
      const pu = r.pickup_id ? pickupById.get(r.pickup_id) : null;
      const de = r.destination_id ? destById.get(r.destination_id) : null;

      const pickupName = pu?.name ?? "—";
      const destName = de?.name ?? "—";
      const routeName =
        r.route_name && String(r.route_name).trim() ? String(r.route_name) : `${pickupName} to ${destName}`;

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

      // Only include routes that have at least one bookable priced departure in window
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

    tiles.sort((a, b) => (a.cheapest?.unit_minor ?? 9e15) - (b.cheapest?.unit_minor ?? 9e15));

    return NextResponse.json({ build_tag: BUILD_TAG, tiles });
  } catch (e: any) {
    return NextResponse.json({ build_tag: BUILD_TAG, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
