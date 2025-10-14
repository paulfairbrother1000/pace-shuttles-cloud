// /src/app/api/ops/finalize-allocations/route.ts
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
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? // fallback to public if server var isn’t set
    "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

/* ---------- Allocation types ---------- */
type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  cap: number;        // max
  min: number;        // min
  preferred: boolean;
};

type AllocMap = Map<UUID, { seats: number; groups: { order_id: UUID; size: number }[] }>;

type DetailedAlloc = {
  byBoat: AllocMap;
  unassigned: Party[];
};

/* ---------- Core allocator: seed→fill→T-72 rebalance ---------- */
/** Boats sort: preferred first, then smaller capacity, then id */
function sortBoatsForFill(a: Boat, b: Boat) {
  if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
  if (a.cap !== b.cap) return a.cap - b.cap;
  return a.vehicle_id.localeCompare(b.vehicle_id);
}

/**
 * Choose a minimal subset of boats to cover total demand (by capacity),
 * preferring preferred boats and smaller caps (consolidation).
 * This naturally drops empties at T-72 when we persist only non-empty.
 */
function chooseMinimalBoatSet(parties: Party[], boats: Boat[]): Boat[] {
  const demand = parties.reduce((s, p) => s + p.size, 0);
  if (demand <= 0) return [];
  const sorted = boats.slice().sort(sortBoatsForFill);
  const out: Boat[] = [];
  let cap = 0;
  for (const b of sorted) {
    out.push(b);
    cap += b.cap;
    if (cap >= demand) break;
  }
  return out;
}

/**
 * Allocate with min constraints:
 * 1) Seed vehicles up to min where possible (preferred→smallest cap)
 * 2) Fill remaining groups up to cap
 * 3) If horizon==T72, rebalance:
 *    - Raise under-min boats using donors (>min) when possible
 *    - Merge away extra under-min boats (leave at most one)
 *    - Allow last under-min to be min-1 if total demand tight
 */
function allocateBalanced(
  parties: Party[],
  boats: Boat[],
  horizon: Horizon
): DetailedAlloc {
  // working state
  type W = { def: Boat; used: number; groups: { order_id: UUID; size: number }[] };
  const boatsSorted = boats.slice().sort(sortBoatsForFill);
  const work = new Map<UUID, W>();
  for (const b of boatsSorted) work.set(b.vehicle_id, { def: b, used: 0, groups: [] });

  const byBoat: AllocMap = new Map();
  const bump = (id: UUID, order_id: UUID, size: number) => {
    const w = work.get(id)!;
    w.used += size;
    w.groups.push({ order_id, size });
    const cur = byBoat.get(id) ?? { seats: 0, groups: [] as { order_id: UUID; size: number }[] };
    cur.seats += size;
    cur.groups.push({ order_id, size });
    byBoat.set(id, cur);
  };

  const remaining = parties
    .filter(p => p.size > 0)
    .sort((a, b) => b.size - a.size); // big → small

  // Phase A: seed to min
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const cand = boatsSorted.find(b => {
        const w = work.get(b.vehicle_id)!;
        const free = b.cap - w.used;
        return w.used < b.min && free >= g.size;
      });
      if (cand) bump(cand.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // Phase B: fill to cap
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const cand = boatsSorted.find(b => {
        const w = work.get(b.vehicle_id)!;
        const free = b.cap - w.used;
        return free >= g.size;
      });
      if (cand) bump(cand.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // Phase C: T-72 rebalance to satisfy mins (allow at most one min-1)
  if (horizon === "T72") {
    const ws = [...work.values()];
    const active = () => ws.filter(w => w.used > 0);
    const underMin = () => active().filter(w => w.used < w.def.min);
    const overMin = () => active().filter(w => w.used > w.def.min);

    // try to move a smallest helpful group from donor to receiver
    const tryMove = (don: W, rec: W) => {
      const free = rec.def.cap - rec.used;
      if (free <= 0) return false;
      const pick = [...don.groups]
        .sort((a, b) => a.size - b.size)
        .find(g => g.size <= free && don.used - g.size >= don.def.min);
      if (!pick) return false;

      // move pick
      don.used -= pick.size;
      rec.used += pick.size;
      don.groups.splice(
        don.groups.findIndex(x => x.order_id === pick.order_id && x.size === pick.size),
        1
      );
      rec.groups.push(pick);

      const dMap = byBoat.get(don.def.vehicle_id)!;
      const rMap =
        byBoat.get(rec.def.vehicle_id) ?? { seats: 0, groups: [] as { order_id: UUID; size: number }[] };
      dMap.seats -= pick.size;
      const idx = dMap.groups.findIndex(x => x.order_id === pick.order_id && x.size === pick.size);
      if (idx >= 0) dMap.groups.splice(idx, 1);
      rMap.seats += pick.size;
      rMap.groups.push(pick);
      byBoat.set(rec.def.vehicle_id, rMap);

      return true;
    };

    // 1) raise receivers to min where possible
    let changed = true;
    while (changed) {
      changed = false;
      // receivers with largest deficit first
      const receivers = underMin().sort(
        (a, b) => (b.def.min - b.used) - (a.def.min - a.used)
      );
      if (!receivers.length) break;

      for (const rec of receivers) {
        const donors = overMin().sort(
          (a, b) => (b.used - b.def.min) - (a.used - a.def.min)
        );
        for (const don of donors) {
          if (tryMove(don, rec)) {
            changed = true;
            break;
          }
        }
      }
    }

    // 2) leave at most one under-min (merge others away)
    let under = underMin().sort((a, b) => a.used - b.used); // smallest first
    while (under.length > 1) {
      const src = under[0];
      let moved = false;

      // targets with most free capacity first; prefer ones already >= min
      const targets = active()
        .filter(w => w.def.vehicle_id !== src.def.vehicle_id)
        .sort((a, b) => {
          const aPref = a.used >= a.def.min ? 0 : 1;
          const bPref = b.used >= b.def.min ? 0 : 1;
          if (aPref !== bPref) return aPref - bPref;
          return (b.def.cap - b.used) - (a.def.cap - a.used);
        });

      for (const g of [...src.groups].sort((a, b) => a.size - b.size)) {
        for (const t of targets) {
          if (t.def.cap - t.used >= g.size) {
            // move g
            src.used -= g.size;
            t.used += g.size;
            src.groups.splice(
              src.groups.findIndex(x => x.order_id === g.order_id && x.size === g.size),
              1
            );
            t.groups.push(g);

            const sMap = byBoat.get(src.def.vehicle_id)!;
            const tMap =
              byBoat.get(t.def.vehicle_id) ??
              ({ seats: 0, groups: [] } as { seats: number; groups: { order_id: UUID; size: number }[] });
            sMap.seats -= g.size;
            const sIdx = sMap.groups.findIndex(x => x.order_id === g.order_id && x.size === g.size);
            if (sIdx >= 0) sMap.groups.splice(sIdx, 1);
            tMap.seats += g.size;
            tMap.groups.push(g);
            byBoat.set(t.def.vehicle_id, tMap);

            moved = true;
            break;
          }
        }
        if (moved) break;
      }

      if (!moved) break; // cannot merge further
      under = underMin().sort((a, b) => a.used - b.used);
    }

    // We allow the last under-min boat to sit at min-1 implicitly when total demand is tight.
  }

  return { byBoat, unassigned: remaining };
}

/* ---------- Data loaders ---------- */

async function loadJourneysScoped(
  sb: ReturnType<typeof sbAdmin>,
  scope: { journey_id?: UUID; operator_id?: UUID | null; all?: boolean }
): Promise<Journey[]> {
  let q = sb
    .from("journeys")
    .select("id,route_id,departure_ts,is_active")
    .gte(
      "departure_ts",
      new Date(new Date().getTime() - 12 * 60 * 60 * 1000).toISOString()
    ) // small drift to catch edge cases
    .eq("is_active", true);

  if (scope.journey_id) q = q.eq("id", scope.journey_id);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as Journey[];
}

async function loadBoatsForRoute(
  sb: ReturnType<typeof sbAdmin>,
  route_id: UUID,
  operatorFilter: UUID | null
): Promise<Boat[]> {
  const [{ data: rvas, error: rvaErr }, { data: vrows, error: vErr }] = await Promise.all([
    sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", route_id)
      .eq("is_active", true),
    sb
      .from("vehicles")
      .select("id,name,active,minseats,maxseats,operator_id")
      .eq("active", true),
  ]);
  if (rvaErr) throw rvaErr;
  if (vErr) throw vErr;

  const vById = new Map<UUID, Vehicle>(((vrows || []) as Vehicle[]).map(v => [v.id as UUID, v]));
  const boats: Boat[] = (rvas || [])
    .map(r => {
      const v = vById.get(r.vehicle_id as UUID);
      if (!v) return null;
      if (operatorFilter && v.operator_id !== operatorFilter) return null;
      const cap = Number(v.maxseats ?? 0) || 0;
      const min = Number(v.minseats ?? 0) || 0;
      return {
        vehicle_id: v.id as UUID,
        cap,
        min,
        preferred: !!r.preferred,
      };
    })
    .filter(Boolean) as Boat[];

  return boats;
}

async function loadPartiesForJourney(
  sb: ReturnType<typeof sbAdmin>,
  j: Journey
): Promise<Party[]> {
  const dep = new Date(j.departure_ts);
  const dateISO = toDateISO(dep);
  const { data: od, error: oErr } = await sb
    .from("orders")
    .select("id,status,route_id,journey_date,qty")
    .eq("status", "paid")
    .eq("route_id", j.route_id)
    .eq("journey_date", dateISO);
  if (oErr) throw oErr;

  return ((od || []) as OrderRow[])
    .map(o => ({
      order_id: o.id,
      size: Math.max(0, Number(o.qty ?? 0)),
    }))
    .filter(p => p.size > 0);
}

/* ---------- One-journey finalizer ---------- */

async function runFinalizeForJourney(
  sb: ReturnType<typeof sbAdmin>,
  j: Journey,
  operatorFilter: UUID | null
): Promise<{ journey_id: UUID; locked: boolean; written: number; reason?: string }> {
  const horizon = horizonFor(j.departure_ts);

  // If T-24 or past → do not rebalance/write
  if (horizon === "T24" || horizon === "past") {
    return { journey_id: j.id, locked: true, written: 0, reason: "T-24 locked — no rebalance" };
  }

  // Parties & boats
  const [parties, allBoats] = await Promise.all([
    loadPartiesForJourney(sb, j),
    loadBoatsForRoute(sb, j.route_id, operatorFilter),
  ]);

  const totalDemand = parties.reduce((s, p) => s + p.size, 0);
  if (totalDemand <= 0) {
    // Clear any existing rows in-scope and exit
    if (operatorFilter) {
      const inScopeVehIds = allBoats.map(b => b.vehicle_id);
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

  if (!allBoats.length) {
    return { journey_id: j.id, locked: false, written: 0, reason: "No boats in scope" };
  }

  // Minimal set then allocate with min-awareness
  const boatSet = chooseMinimalBoatSet(parties, allBoats);
  const alloc = allocateBalanced(parties, boatSet, horizon);

  // Persist non-empty boats only (dropping empties at T-72)
  const nonEmptyVehIds = Array.from(alloc.byBoat.entries())
    .filter(([_, rec]) => (rec?.seats || 0) > 0)
    .map(([vehId]) => vehId);

  // Replace rows for this journey (scoped if operatorFilter provided)
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

/* ---------- API Route ---------- */
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
      return NextResponse.json({
        ok: true,
        changed: 0,
        details: [],
        note: "No journeys in scope",
      });
    }

    const results: Array<{ journey_id: UUID; locked: boolean; written: number; reason?: string }> =
      [];
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
