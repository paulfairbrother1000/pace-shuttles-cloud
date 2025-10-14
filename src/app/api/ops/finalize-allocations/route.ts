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
  preferred?: boolean | null; // joined from RVA
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
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
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
  operator_id: UUID | null;
  preferred: boolean;
};
type AllocMap = Map<UUID, { seats: number; groups: { order_id: UUID; size: number }[] }>;

function sortBoats(a: Boat, b: Boat) {
  // preferred first, then smaller cap
  if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
  if (a.cap !== b.cap) return a.cap - b.cap;
  return a.vehicle_id.localeCompare(b.vehicle_id);
}

/**
 * >72h multi-operator feed:
 * - Fill a single boat per operator to its MIN before feeding the next operator.
 * - After all operators have one boat at MIN (or demand ends), continue round-robin.
 */
function allocateRoundRobinByOperator(parties: Party[], boats: Boat[]): AllocMap {
  const byOp = new Map<string, Boat[]>();
  for (const b of boats.slice().sort(sortBoats)) {
    const key = b.operator_id ?? "none";
    byOp.set(key, [...(byOp.get(key) ?? []), b]);
  }
  const opKeys = [...byOp.keys()].sort(); // stable rotation
  const byBoat: AllocMap = new Map();
  const used = new Map<UUID, number>();

  function bump(id: UUID, order_id: UUID, size: number) {
    used.set(id, (used.get(id) ?? 0) + size);
    const cur = byBoat.get(id) ?? { seats: 0, groups: [] as { order_id: UUID; size: number }[] };
    cur.seats += size;
    cur.groups.push({ order_id, size });
    byBoat.set(id, cur);
  }

  const remaining = parties.slice().sort((a, b) => b.size - a.size); // big→small
  const iter = () => {
    for (const op of opKeys) {
      const stack = byOp.get(op)!; // boats for this operator
      // pick the first boat that is not full; prefer ones below min
      let target: Boat | null = null;
      for (const b of stack) {
        const u = used.get(b.vehicle_id) ?? 0;
        if (u < b.cap) {
          target = b;
          // if still below min, break immediately (we must top to min first)
          if (u < b.min) break;
        }
      }
      if (!target) continue;

      // feed the largest party that fits
      const idx = remaining.findIndex((g) => g.size <= (target!.cap - (used.get(target!.vehicle_id) ?? 0)));
      if (idx === -1) continue;
      const [g] = remaining.splice(idx, 1);
      bump(target.vehicle_id, g.order_id, g.size);
      return true; // made progress
    }
    return false;
  };

  let progress = true;
  while (remaining.length && progress) progress = iter();

  return byBoat;
}

/** T-72 gating: keep only in-play vehicles (already had rows), drop empties, require MIN except single-boat MIN-1 */
function enforceT72Gates(byBoat: AllocMap, boats: Boat[], inPlay: Set<UUID>): AllocMap {
  // 1) Keep only in-play vehicles
  const gated = new Map<UUID, { seats: number; groups: { order_id: UUID; size: number }[] }>();
  for (const [vid, rec] of byBoat.entries()) {
    if (inPlay.has(vid)) gated.set(vid, rec);
  }

  // 2) Drop empties
  for (const [vid, rec] of [...gated.entries()]) {
    if ((rec?.seats ?? 0) <= 0) gated.delete(vid);
  }

  // 3) Require MIN except single-boat MIN-1
  const survivors = [...gated.entries()];
  if (!survivors.length) return gated;

  if (survivors.length === 1) {
    const [vid, rec] = survivors[0];
    const def = boats.find((b) => b.vehicle_id === vid);
    if (!def) return gated;
    if (rec.seats >= def.min - 1) {
      // allowed (single-boat min-1)
      return gated;
    } else {
      // below threshold → drop
      gated.delete(vid);
      return gated;
    }
  }

  // >1 boats: all must meet MIN
  for (const [vid, rec] of [...gated.entries()]) {
    const def = boats.find((b) => b.vehicle_id === vid);
    if (!def) continue;
    if (rec.seats < def.min) gated.delete(vid);
  }

  return gated;
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
    )
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
  // RVAs + Vehicles (active)
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
        operator_id: v.operator_id,
        preferred: !!(r as any).preferred,
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

  // Existing in-play vehicles (from current allocations)
  const { data: existing } = await sb
    .from("journey_vehicle_allocations")
    .select("vehicle_id,seats")
    .eq("journey_id", j.id);

  const inPlay = new Set<UUID>((existing ?? []).map((r: any) => r.vehicle_id as UUID));

  // >72h: allocate round-robin by operator (min-first)
  let allocByBoat: AllocMap = allocateRoundRobinByOperator(parties, allBoats);

  // T-72: gate by in-play + min rules + drop empties
  if (horizon === "T72") {
    allocByBoat = enforceT72Gates(allocByBoat, allBoats, inPlay);
  }

  // Persist non-empty boats only
  const nonEmptyVehIds = Array.from(allocByBoat.entries())
    .filter(([_, rec]) => (rec?.seats || 0) > 0)
    .map(([vid]) => vid);

  // Replace rows for this journey (scoped if operatorFilter provided)
  if (operatorFilter) {
    const inScopeVehIds = (horizon === "T72")
      ? [...inPlay] // at T-72 only touch in-play vehicles
      : allBoats.map(b => b.vehicle_id);
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
  for (const [vehId, info] of allocByBoat.entries()) {
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
