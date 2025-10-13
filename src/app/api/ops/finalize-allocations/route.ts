import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type UUID = string;

type Journey = {
  id: UUID;
  route_id: UUID;
  departure_ts: string;
  is_active: boolean | null;
};

type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean | null };
type Vehicle = {
  id: UUID;
  name: string | null;
  active: boolean | null;
  minseats: number | string | null;
  maxseats: number | string | null;
  operator_id: UUID | null;
};

type OrderRow = {
  id: UUID;
  status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired";
  route_id: UUID | null;
  journey_date: string | null; // YYYY-MM-DD
  qty: number | null;
};

type LockRow = { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number };

function sbAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

function toDateISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Horizon = "T24" | "T72" | ">72h" | "past";
function horizonFor(tsISO: string): Horizon {
  const now = new Date();
  const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (h <= 24) return "T24";
  if (h <= 72) return "T72";
  return ">72h";
}

type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  cap: number;
  min: number;
  preferred: boolean;
};

type Alloc = Map<UUID, { seats: number; groups: { order_id: UUID; size: number }[] }>;

function allocateGreedy(parties: Party[], boats: Boat[]): {
  byBoat: Alloc;
  unassigned: Party[];
} {
  // Sort parties (big→small), boats (preferred first then smallest capacity so we fill tighter boats first)
  const sortedParties = [...parties].filter(p => p.size > 0).sort((a, b) => b.size - a.size);
  const state = boats
    .map(b => ({
      id: b.vehicle_id,
      cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
      min: Math.max(0, Math.floor(Number(b.min) || 0)),
      used: 0,
      preferred: !!b.preferred,
    }))
    .sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      if (a.cap !== b.cap) return a.cap - b.cap;
      return a.id.localeCompare(b.id);
    });

  const byBoat: Alloc = new Map();
  const unassigned: Party[] = [];

  for (const g of sortedParties) {
    const candidates = state
      .map(s => ({ id: s.id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter(c => c.free >= g.size)
      .sort((a, b) => {
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        if (a.free !== b.free) return a.free - b.free;
        return a.id.localeCompare(b.id);
      });

    if (!candidates.length) {
      unassigned.push(g);
      continue;
    }

    const chosen = candidates[0];
    chosen.ref.used += g.size;
    const cur = byBoat.get(chosen.id) ?? { seats: 0, groups: [] as { order_id: UUID; size: number }[] };
    cur.seats += g.size;
    cur.groups.push({ order_id: g.order_id, size: g.size });
    byBoat.set(chosen.id, cur);
  }

  return { byBoat, unassigned };
}

/**
 * Given boats + parties, choose a *minimal* subset of boats to cover demand.
 * Strategy: sort by preferred then capacity asc; include boats until capacity >= demand.
 * (This tends to consolidate, and it naturally drops empties at T-72.)
 */
function chooseMinimalBoatSet(parties: Party[], boats: Boat[]): Boat[] {
  const demand = parties.reduce((s, p) => s + p.size, 0);
  if (demand <= 0) return [];

  const sorted = boats
    .slice()
    .sort((a, b) => {
      if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
      if (a.cap !== b.cap) return a.cap - b.cap;
      return a.vehicle_id.localeCompare(b.vehicle_id);
    });

  const out: Boat[] = [];
  let cap = 0;
  for (const b of sorted) {
    out.push(b);
    cap += b.cap;
    if (cap >= demand) break;
  }
  return out;
}

async function loadJourneysScoped(
  sb: ReturnType<typeof sbAdmin>,
  scope: { journey_id?: UUID; operator_id?: UUID | null; all?: boolean }
): Promise<Journey[]> {
  let q = sb
    .from("journeys")
    .select("id,route_id,departure_ts,is_active")
    .gte("departure_ts", new Date(new Date().getTime() - 12 * 60 * 60 * 1000).toISOString()) // small drift
    .eq("is_active", true);

  if (scope.journey_id) {
    q = q.eq("id", scope.journey_id);
  }

  const { data, error } = await q;
  if (error) throw error;

  // If operator filter is provided, we’ll still fetch journeys, but will later filter boats by operator.
  return (data || []) as Journey[];
}

async function runFinalizeForJourney(
  sb: ReturnType<typeof sbAdmin>,
  j: Journey,
  operatorFilter: UUID | null
): Promise<{ journey_id: UUID; locked: boolean; written: number; reason?: string }> {
  const horizon = horizonFor(j.departure_ts);

  // Fetch RVAs & Vehicles
  const { data: rvas, error: rvaErr } = await sb
    .from("route_vehicle_assignments")
    .select("route_id,vehicle_id,is_active,preferred")
    .eq("route_id", j.route_id)
    .eq("is_active", true);
  if (rvaErr) throw rvaErr;

  const vehIds = Array.from(new Set((rvas || []).map(r => r.vehicle_id)));
  const { data: vrows, error: vErr } = await sb
    .from("vehicles")
    .select("id,name,active,minseats,maxseats,operator_id")
    .in("id", vehIds.length ? vehIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("active", true);
  if (vErr) throw vErr;
  const vehicles = (vrows || []) as Vehicle[];

  // Build boat candidates, respecting operator filter if present
  const boats: Boat[] = (rvas || [])
    .map(r => {
      const v = vehicles.find(x => x.id === r.vehicle_id);
      if (!v) return null;
      if (operatorFilter && v.operator_id !== operatorFilter) return null;
      const cap = Number(v.maxseats ?? 0) || 0;
      const min = Number(v.minseats ?? 0) || 0;
      return { vehicle_id: v.id, cap, min, preferred: !!r.preferred };
    })
    .filter(Boolean) as Boat[];

  // Orders for this route + date
  const dep = new Date(j.departure_ts);
  const dateISO = toDateISO(dep);
  const { data: od, error: oErr } = await sb
    .from("orders")
    .select("id,status,route_id,journey_date,qty")
    .eq("status", "paid")
    .eq("route_id", j.route_id)
    .eq("journey_date", dateISO);
  if (oErr) throw oErr;

  const parties: Party[] = (od || [])
    .map((o: any) => ({ order_id: o.id as UUID, size: Math.max(0, Number(o.qty ?? 0)) }))
    .filter(p => p.size > 0);

  // If T-24 or past: do *not* rebalance. We just report that it’s locked.
  if (horizon === "T24" || horizon === "past") {
    return { journey_id: j.id, locked: true, written: 0, reason: "T-24 locked — no rebalance" };
  }

  // No demand → clear any existing JVA rows for this journey (within operator scope) and exit.
  const totalDemand = parties.reduce((s, p) => s + p.size, 0);
  if (totalDemand <= 0) {
    // Clear allocations for this journey in-scope
    if (operatorFilter) {
      // We need the in-scope vehicle ids
      const inScopeVehIds = boats.map(b => b.vehicle_id);
      if (inScopeVehIds.length) {
        await sb
          .from("journey_vehicle_allocations")
          .delete()
          .eq("journey_id", j.id)
          .in("vehicle_id", inScopeVehIds);
      }
    } else {
      await sb.from("journey_vehicle_allocations").delete().eq("journey_id", j.id);
    }
    return { journey_id: j.id, locked: false, written: 0, reason: "No demand — cleared" };
  }

  // Pick minimal boat set to satisfy demand (T-72 rule: drop empties, keep as few boats as possible)
  const boatSet = chooseMinimalBoatSet(parties, boats);
  if (!boatSet.length) {
    // Nothing to write (no boats in scope)
    return { journey_id: j.id, locked: false, written: 0, reason: "No boats in scope" };
  }

  // Allocate groups across chosen boats
  const alloc = allocateGreedy(parties, boatSet);

  // Drop boats that received nothing (T-72 drop-empties)
  const nonEmptyVehIds = Array.from(alloc.byBoat.entries())
    .filter(([_, v]) => (v?.seats || 0) > 0)
    .map(([vid]) => vid);

  // If operator scoped, delete only in-scope vehicles; else delete all for the journey.
  if (operatorFilter) {
    const inScopeVehIds = boatSet.map(b => b.vehicle_id);
    if (inScopeVehIds.length) {
      await sb
        .from("journey_vehicle_allocations")
        .delete()
        .eq("journey_id", j.id)
        .in("vehicle_id", inScopeVehIds);
    }
  } else {
    await sb.from("journey_vehicle_allocations").delete().eq("journey_id", j.id);
  }

  // Insert new rows
  const rowsToInsert: LockRow[] = [];
  for (const [vehId, info] of alloc.byBoat.entries()) {
    if (!nonEmptyVehIds.includes(vehId)) continue;
    for (const g of info.groups) {
      rowsToInsert.push({
        journey_id: j.id,
        vehicle_id: vehId,
        order_id: g.order_id,
        seats: g.size,
      });
    }
  }

  if (rowsToInsert.length) {
    const { error: insErr } = await sb.from("journey_vehicle_allocations").insert(rowsToInsert);
    if (insErr) throw insErr;
  }

  return { journey_id: j.id, locked: false, written: rowsToInsert.length };
}

// POST /api/ops/finalize-allocations
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      journey_id?: UUID;
      operator_id?: UUID;
      all?: boolean;
    };

    const sb = sbAdmin();

    const journeys = await loadJourneysScoped(sb, {
      journey_id: body.journey_id,
      operator_id: body.all ? null : body.operator_id ?? null,
      all: !!body.all,
    });

    if (!journeys.length) {
      return NextResponse.json({ ok: true, changed: 0, details: [], note: "No journeys in scope" });
    }

    const results: Array<{ journey_id: UUID; locked: boolean; written: number; reason?: string }> = [];
    for (const j of journeys) {
      const res = await runFinalizeForJourney(sb, j, body.all ? null : body.operator_id ?? null);
      results.push(res);
    }

    const changed = results.reduce((s, r) => s + (r.written || 0), 0);
    return NextResponse.json({ ok: true, changed, details: results });
  } catch (e: any) {
    console.error("finalize-allocations error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Finalize failed" },
      { status: 500 }
    );
  }
}
