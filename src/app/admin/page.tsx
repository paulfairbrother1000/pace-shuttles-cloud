// /src/app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

/* ---------- DB Types ---------- */
type Journey = {
  id: UUID;
  route_id: UUID;
  departure_ts: string; // timestamptz ISO
  is_active: boolean;
};

type Route = { id: UUID; pickup_id: UUID; destination_id: UUID };
type Pickup = { id: UUID; name: string };
type Destination = { id: UUID; name: string };

type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean };

type Vehicle = {
  id: UUID;
  name: string;
  active: boolean | null;
  minseats: number | string | null;
  maxseats: number | string | null;
  operator_id: UUID | null;
};

type Operator = { id: UUID; name: string };

type Order = {
  id: UUID;
  status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired";
  route_id: UUID | null;
  journey_date: string | null; // YYYY-MM-DD
  qty: number | null;
};

type JVALockRow = { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number };

/* ---------- Crew types ---------- */
type StaffRow = {
  id: UUID; // operator_staff.id
  user_id: UUID | null;
  operator_id: UUID;
  first_name: string | null;
  last_name: string | null;
  active: boolean | null;
  role_id: UUID | null;
  jobrole: string | null;
};

type AssignView = {
  assignment_id: UUID;
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID;
  status_simple: "allocated" | "confirmed" | "complete";
  first_name: string | null;
  last_name: string | null;
  role_label?: string | null;
};

/* ---------- Client Helpers ---------- */
const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

function toDateISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function horizonFor(tsISO: string): "T24" | "T72" | ">72h" | "past" {
  const now = new Date();
  const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (h < 24) return "T24";
  if (h < 72) return "T72";
  return ">72h";
}

function isT72orT24(h: "T24" | "T72" | ">72h" | "past") {
  return h === "T24" || h === "T72";
}

function todayTomorrowLabel(tsISO: string): "today" | "tomorrow" | null {
  const dep = new Date(tsISO);
  const now = new Date();
  const depKey = dep.toDateString();
  const nowKey = now.toDateString();
  if (depKey === nowKey) return "today";
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  if (depKey === tmr.toDateString()) return "tomorrow";
  return null;
}

/* ---------- Allocation (preview) ---------- */
type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  preferred: boolean;
  min: number;
  max: number;
  operator_id?: UUID | null;
  price_cents?: number | null;
};

type DetailedAlloc = {
  byBoat: Map<
    UUID,
    {
      seats: number;
      orders: { order_id: UUID; size: number }[];
    }
  >;
  unassigned: { order_id: UUID; size: number }[];
  total: number;
};

function boatTieBreak(a: Boat, b: Boat) {
  if ((a.operator_id || null) === (b.operator_id || null)) {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
  }
  return a.vehicle_id.localeCompare(b.vehicle_id);
}

function allocateDetailed(
  parties: Party[],
  boats: Boat[],
  opts?: { horizon?: "T24" | "T72" | ">72h" | "past" }
): DetailedAlloc {
  const horizon = opts?.horizon ?? ">72h";

  const boatRank = (a: Boat, b: Boat) => {
    const pa = a.price_cents ?? 0;
    const pb = b.price_cents ?? 0;
    if (pa !== pb) return pa - pb;

    const sameOp = (a.operator_id ?? null) === (b.operator_id ?? null);
    if (sameOp && a.preferred !== b.preferred) return a.preferred ? -1 : 1;

    return String(a.vehicle_id).localeCompare(String(b.vehicle_id));
  };

  const boatsSorted = [...boats].sort(boatRank);

  type W = {
    def: Boat;
    used: number;
    groups: { order_id: UUID; size: number }[];
  };
  const work = new Map<UUID, W>();
  boatsSorted.forEach((b) =>
    work.set(b.vehicle_id, { def: b, used: 0, groups: [] })
  );

  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  const bump = (boatId: UUID, order_id: UUID, size: number) => {
    const w = work.get(boatId)!;
    w.used += size;
    w.groups.push({ order_id, size });

    const cur = byBoat.get(boatId) ?? { seats: 0, orders: [] };
    cur.seats += size;
    cur.orders.push({ order_id, size });
    byBoat.set(boatId, cur);
  };

  const remaining: Party[] = [...parties]
    .filter((p) => p.size > 0)
    .sort((a, b) => b.size - a.size);

  const unassigned: { order_id: UUID; size: number }[] = [];

  // Phase A — seed vehicles to MIN in price order
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const candidate = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return w.used < b.min && free >= g.size;
      });
      if (candidate) {
        bump(candidate.vehicle_id, g.order_id, g.size);
      } else {
        next.push(g);
      }
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // Phase B — after all seeded to MIN, fill cheapest-first up to MAX
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const candidate = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return free >= g.size;
      });
      if (candidate) {
        bump(candidate.vehicle_id, g.order_id, g.size);
      } else {
        next.push(g);
      }
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  for (const g of remaining) unassigned.push({ order_id: g.order_id, size: g.size });

  if (horizon === "T72") {
    const active = () => [...work.values()].filter((w) => w.used > 0);
    const underMin = () => active().filter((w) => w.used < w.def.min);
    const overMin = () => active().filter((w) => w.used > w.def.min);

    const tryMove = (donor: W, receiver: W) => {
      const free = receiver.def.max - receiver.used;
      if (free <= 0) return false;

      const sorted = [...donor.groups].sort((a, b) => a.size - b.size);
      let pick: { order_id: UUID; size: number } | null = null;

      for (const g of sorted) {
        if (g.size > free) continue;
        const donorWouldBe = donor.used - g.size;
        if (donorWouldBe < donor.def.min) continue;

        const recvWouldBe = receiver.used + g.size;
        if (recvWouldBe === receiver.def.min) {
          pick = g;
          break;
        }
        pick = pick ?? g;
      }
      if (!pick) return false;

      donor.used -= pick.size;
      receiver.used += pick.size;

      const idx = donor.groups.findIndex(
        (x) => x.order_id === pick!.order_id && x.size === pick!.size
      );
      if (idx >= 0) donor.groups.splice(idx, 1);
      receiver.groups.push(pick);

      const dMap = byBoat.get(donor.def.vehicle_id)!;
      const rMap = byBoat.get(receiver.def.vehicle_id) ?? { seats: 0, orders: [] };
      dMap.seats -= pick.size;
      const boIdx = dMap.orders.findIndex(
        (x) => x.order_id === pick!.order_id && x.size === pick!.size
      );
      if (boIdx >= 0) dMap.orders.splice(boIdx, 1);
      rMap.seats += pick.size;
      rMap.orders.push(pick);
      byBoat.set(receiver.def.vehicle_id, rMap);

      return true;
    };

    let changed = true;
    while (changed) {
      changed = false;
      const receivers = underMin().sort(
        (a, b) => b.def.min - b.used - (a.def.min - a.used)
      );
      if (!receivers.length) break;

      for (const recv of receivers) {
        const donors = overMin().sort(
          (a, b) => b.used - b.def.min - (a.used - a.def.min)
        );
        for (const don of donors) {
          if (tryMove(don, recv)) {
            changed = true;
            break;
          }
        }
      }
    }

    const activeW = () => [...work.values()].filter((w) => w.used > 0);
    let under = activeW()
      .filter((w) => w.used < w.def.min)
      .sort((a, b) => a.used - b.used);
    while (under.length > 1) {
      const src = under[0];
      let movedAnything = false;

      const targets = activeW()
        .filter((w) => w.def.vehicle_id !== src.def.vehicle_id)
        .sort((a, b) => {
          const aPref = a.used >= a.def.min ? 0 : 1;
          const bPref = b.used >= b.def.min ? 0 : 1;
          if (aPref !== bPref) return aPref - bPref;
          return b.def.max - b.used - (a.def.max - a.used);
        });

      for (const g of [...src.groups].sort((a, b) => a.size - b.size)) {
        for (const tgt of targets) {
          const free = tgt.def.max - tgt.used;
          if (g.size > free) continue;

          src.used -= g.size;
          tgt.used += g.size;

          const idx = src.groups.findIndex(
            (x) => x.order_id === g.order_id && x.size === g.size
          );
          if (idx >= 0) src.groups.splice(idx, 1);
          tgt.groups.push(g);

          const sMap = byBoat.get(src.def.vehicle_id)!;
          const tMap = byBoat.get(tgt.def.vehicle_id) ?? { seats: 0, orders: [] };
          sMap.seats -= g.size;
          const boIdx = sMap.orders.findIndex(
            (x) => x.order_id === g.order_id && x.size === g.size
          );
          if (boIdx >= 0) sMap.orders.splice(boIdx, 1);
          tMap.seats += g.size;
          tMap.orders.push(g);
          byBoat.set(tgt.def.vehicle_id, tMap);

          movedAnything = true;
          break;
        }
      }

      if (!movedAnything) break;
      under = activeW()
        .filter((w) => w.used < w.def.min)
        .sort((a, b) => a.used - b.used);
    }
  }

  const total = parties.reduce((s, p) => s + (p.size || 0), 0);
  return { byBoat, unassigned, total };
}

/* ---------- Final (T-24) allocator ---------- */
function allocateFinalT24(parties: Party[], boats: Boat[]): DetailedAlloc {
  const groups = [...parties].filter((g) => g.size > 0).sort((a, b) => b.size - a.size);
  const ranked = [...boats].sort((a, b) => {
    const pa = a.price_cents ?? 0;
    const pb = b.price_cents ?? 0;
    if (pa !== pb) return pa - pb;
    const sameOp = (a.operator_id ?? null) === (b.operator_id ?? null);
    if (sameOp && a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return String(a.vehicle_id).localeCompare(String(b.vehicle_id));
  });

  const total = groups.reduce((s, g) => s + g.size, 0);
  if (!ranked.length) {
    throw new Error("No vehicles available for this route.");
  }

  let chosen: Boat[] | null = null;
  for (let k = 1; k <= ranked.length; k++) {
    const subset = ranked.slice(0, k);
    const minSum = subset.reduce((s, b) => s + b.min, 0);
    const maxSum = subset.reduce((s, b) => s + b.max, 0);
    if (total >= minSum && total <= maxSum) {
      chosen = subset;
      break;
    }
  }
  if (!chosen) {
    for (let k = 1; k <= ranked.length; k++) {
      const subset = ranked.slice(0, k);
      const maxSum = subset.reduce((s, b) => s + b.max, 0);
      if (total <= maxSum) {
        chosen = subset;
        break;
      }
    }
  }
  if (!chosen) throw new Error("Capacity window exceeded: total passengers exceed fleet max.");

  type Bucket = { def: Boat; used: number; orders: Party[] };
  const buckets: Bucket[] = chosen.map((b) => ({ def: b, used: 0, orders: [] }));

  const place = (i: number, g: Party) => {
    buckets[i].used += g.size;
    buckets[i].orders.push(g);
  };

  const findReceiverForMin = (g: Party): number => {
    let best = -1;
    let bestDeficit = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const free = b.def.max - b.used;
      if (free < g.size) continue;
      const deficit = Math.max(0, b.def.min - b.used);
      if (deficit <= 0) continue;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = i;
      }
    }
    return best;
  };

  const remaining: Party[] = [];
  for (const g of groups) {
    const idx = findReceiverForMin(g);
    if (idx >= 0) place(idx, g);
    else remaining.push(g);
  }

  const belowMin = buckets.filter((b) => b.used > 0 && b.used < b.def.min);
  if (belowMin.length > 0) {
    const single = ranked[0];
    if (total >= single.min && total <= single.max) {
      const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
      byBoat.set(single.vehicle_id, {
        seats: total,
        orders: groups.map((g) => ({ order_id: g.order_id, size: g.size })),
      });
      return { byBoat, unassigned: [], total };
    }
    throw new Error(
      "Cannot meet minimum seats across selected boats. Total passengers below the smallest min."
    );
  }

  for (const g of remaining) {
    let target = -1;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const free = b.def.max - b.used;
      if (free < g.size) continue;
      const projected = b.used + g.size;
      if (projected < bestLoad) {
        bestLoad = projected;
        target = i;
      }
    }
    if (target === -1) {
      throw new Error("A group cannot fit within max capacities. Consider opening another boat.");
    }
    place(target, g);
  }

  for (const b of buckets) {
    if (b.used > 0 && b.used < b.def.min) {
      throw new Error(`Boat would run below min (${b.used} < ${b.def.min}).`);
    }
    if (b.used > b.def.max) {
      throw new Error(`Boat would exceed max (${b.used} > ${b.def.max}).`);
    }
  }

  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  for (const b of buckets) {
    if (b.used <= 0) continue;
    byBoat.set(b.def.vehicle_id, {
      seats: b.used,
      orders: b.orders.map((o) => ({ order_id: o.order_id, size: o.size })),
    });
  }
  return { byBoat, unassigned: [], total };
}

/* ---------- Page ---------- */
export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [rvas, setRVAs] = useState<RVA[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  // Persisted locks we read back from DB
  const [locksByJourney, setLocksByJourney] = useState<Map<UUID, JVALockRow[]>>(new Map());

  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  // Crew/assignments
  const [assigns, setAssigns] = useState<AssignView[]>([]);
  const [staffByOperator, setStaffByOperator] = useState<Map<UUID, StaffRow[]>>(new Map());
  const [assigning, setAssigning] = useState<string | null>(null); // key journeyId_vehicleId
  const [selectedStaff, setSelectedStaff] = useState<Record<string, UUID>>({}); // key -> staff_id

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);

      try {
        // 1) future, active journeys
        const { data: jData, error: jErr } = await supabase
          .from("journeys")
          .select("id,route_id,departure_ts,is_active")
          .gte("departure_ts", new Date().toISOString())
          .eq("is_active", true)
          .order("departure_ts", { ascending: true });
        if (jErr) throw jErr;

        const js = (jData || []) as Journey[];
        if (off) return;

        setJourneys(js);
        const routeIds = Array.from(new Set(js.map((j) => j.route_id)));
        const journeyIds = js.map((j) => j.id);

        // 2) lookups
        const [rQ, puQ, deQ] = await Promise.all([
          supabase.from("routes").select("id,pickup_id,destination_id").in("id", routeIds),
          supabase.from("pickup_points").select("id,name"),
          supabase.from("destinations").select("id,name"),
        ]);
        if (rQ.error) throw rQ.error;
        if (puQ.error) throw puQ.error;
        if (deQ.error) throw deQ.error;

        setRoutes((rQ.data || []) as Route[]);
        setPickups((puQ.data || []) as Pickup[]);
        setDestinations((deQ.data || []) as Destination[]);

        // 3) RVAs, vehicles, operators
        const [rvaQ, vQ, oQ] = await Promise.all([
          supabase
            .from("route_vehicle_assignments")
            .select("route_id,vehicle_id,is_active,preferred")
            .in("route_id", routeIds)
            .eq("is_active", true),
          supabase
            .from("vehicles")
            .select("id,name,active,minseats,maxseats,operator_id")
            .eq("active", true),
          supabase.from("operators").select("id,name"),
        ]);
        if (rvaQ.error) throw rvaQ.error;
        if (vQ.error) throw vQ.error;
        if (oQ.error) throw oQ.error;

        setRVAs((rvaQ.data || []) as RVA[]);
        setVehicles((vQ.data || []) as Vehicle[]);
        setOperators((oQ.data || []) as Operator[]);

        // 4) paid orders (filter via route+date window)
        const dateSet = new Set(js.map((j) => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // 5) read persisted locks (if any)
        if (journeyIds.length) {
          const { data: lockData, error: lockErr } = await supabase
            .from("journey_vehicle_allocations")
            .select("journey_id,vehicle_id,order_id,seats")
            .in("journey_id", journeyIds);
          if (lockErr) throw lockErr;

          const m = new Map<UUID, JVALockRow[]>();
          (lockData || []).forEach((row: any) => {
            const arr = m.get(row.journey_id) ?? [];
            arr.push({
              journey_id: row.journey_id,
              vehicle_id: row.vehicle_id,
              order_id: row.order_id,
              seats: Number(row.seats || 0),
            });
            m.set(row.journey_id, arr);
          });
          setLocksByJourney(m);
        } else {
          setLocksByJourney(new Map());
        }

        // 6) current lead assignments for these journeys (view)
        if (journeyIds.length) {
          const { data: aData } = await supabase
            .from("v_crew_assignments_min")
            .select(
              "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
            )
            .in("journey_id", journeyIds);

          const lead = ((aData as AssignView[]) ?? []).filter(
            (r) => (r.role_label ?? "").toLowerCase() !== "crew"
          );
          setAssigns(lead);
        } else {
          setAssigns([]);
        }

        // 7) staff lists per operator for all involved vehicles
        const operatorIds = Array.from(
          new Set((vQ.data || []).map((v: any) => v.operator_id).filter(Boolean))
        ) as UUID[];

        if (operatorIds.length) {
          const { data: sData } = await supabase
            .from("operator_staff")
            .select(
              "id,user_id,operator_id,first_name,last_name,active,role_id,jobrole"
            )
            .in("operator_id", operatorIds)
            .eq("active", true);

          const map = new Map<UUID, StaffRow[]>();
          (sData as StaffRow[] | null)?.forEach((s) => {
            const key = s.operator_id;
            const arr = map.get(key) ?? [];
            arr.push(s);
            map.set(key, arr);
          });

          for (const [key, arr] of map.entries()) {
            arr.sort((a, b) => {
              const an = `${a.last_name || ""} ${a.first_name || ""}`
                .toLowerCase()
                .trim();
              const bn = `${b.last_name || ""} ${b.first_name || ""}`
                .toLowerCase()
                .trim();
              return an.localeCompare(bn);
            });
            map.set(key, arr);
          }

          setStaffByOperator(map);
        } else {
          setStaffByOperator(new Map());
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  /* ---------- Lookups ---------- */
  const routeById = useMemo(() => {
    const m = new Map<UUID, Route>();
    routes.forEach((r) => m.set(r.id, r));
    return m;
  }, [routes]);

  const pickupNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    pickups.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [pickups]);

  const destNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    destinations.forEach((d) => m.set(d.id, d.name));
    return m;
  }, [destinations]);

  const vehicleById = useMemo(() => {
    const m = new Map<UUID, Vehicle>();
    vehicles.forEach((v) => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const operatorNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    operators.forEach((o) => m.set(o.id, o.name || "—"));
    return m;
  }, [operators]);

  const assignByKey = useMemo(() => {
    const m = new Map<string, AssignView>();
    (assigns ?? []).forEach((a) => m.set(`${a.journey_id}_${a.vehicle_id}`, a));
    return m;
  }, [assigns]);

  /* ---------- UI Rows ---------- */
  type UiBoat = {
    vehicle_id: UUID | "__unassigned__";
    vehicle_name: string;
    operator_name: string;
    operator_id?: UUID | null;
    db: number;
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
    assignee?: { staff_id: UUID; name: string; status: AssignView["status_simple"] };
  };

  type UiRow = {
    journey: Journey;
    pickup: string;
    destination: string;
    depDate: string;
    depTime: string;
    horizon: "T24" | "T72" | ">72h" | "past";
    contextDay?: "today" | "tomorrow" | null;
    isLocked: boolean;
    perBoat: UiBoat[];
    totals: {
      proj: number;
      dbTotal: number;
      maxTotal: number;
      unassigned: number;
    };
    previewAlloc?: DetailedAlloc;
    lockedAlloc?: JVALockRow[];
    parties?: Party[];
    boats?: Boat[];
    atRiskBelowMin?: boolean;
  };

  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length) return [];

    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const k = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(k) ?? [];
      arr.push(o);
      ordersByKey.set(k, arr);
    }

    const rvasByRoute = new Map<UUID, RVA[]>();
    for (const r of rvas) {
      if (!r.is_active) continue;
      const arr = rvasByRoute.get(r.route_id) ?? [];
      arr.push(r);
      rvasByRoute.set(r.route_id, arr);
    }

    const out: UiRow[] = [];

    for (const j of journeys) {
      const r = routeById.get(j.route_id);
      if (!r) continue;

      const dep = new Date(j.departure_ts);
      const dateISO = toDateISO(dep);
      const horizon = horizonFor(j.departure_ts);
      const ctxDay = todayTomorrowLabel(j.departure_ts);

      const oArr = ordersByKey.get(`${j.route_id}_${dateISO}`) ?? [];
      const parties: Party[] = oArr
        .map((o) => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter((g) => g.size > 0);

      if (!parties.length) continue;

      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter((x) => x.is_active);
      const boats: Boat[] = rvaArr
        .map((x) => {
          const v = vehicleById.get(x.vehicle_id);
          if (!v || v.active === false) return null;
          const min = Number(v?.minseats ?? 0);
          const max = Number(v?.maxseats ?? 0);
          return {
            vehicle_id: x.vehicle_id,
            preferred: !!x.preferred,
            min: Number.isFinite(min) ? min : 0,
            max: Number.isFinite(max) ? max : 0,
            operator_id: v.operator_id ?? null,
            price_cents: null,
          };
        })
        .filter(Boolean) as Boat[];

      let previewAlloc = allocateDetailed(parties, boats, { horizon });

      const maxTotal = boats.reduce((s, b) => s + b.max, 0);

      const locked = locksByJourney.get(j.id) ?? [];
      const isLocked = locked.length > 0;

      const perBoat: UiBoat[] = [];
      let dbTotal = 0;
      let unassigned = 0;

      if (isLocked) {
        const groupByVeh = new Map<UUID, { seats: number; groups: number[] }>();
        for (const row of locked) {
          const cur = groupByVeh.get(row.vehicle_id) ?? { seats: 0, groups: [] };
          cur.seats += Number(row.seats || 0);
          cur.groups.push(Number(row.seats || 0));
          groupByVeh.set(row.vehicle_id, cur);
        }

        for (const [vehId, data] of groupByVeh.entries()) {
          const v = vehicleById.get(vehId);
          const min = v?.minseats != null ? Number(v.minseats) : null;
          const max = v?.maxseats != null ? Number(v.maxseats) : null;
          dbTotal += data.seats;

          const a = assignByKey.get(`${j.id}_${vehId}`);
          const assignee =
            a && a.staff_id
              ? {
                  staff_id: a.staff_id,
                  name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Unnamed",
                  status: a.status_simple,
                }
              : undefined;

          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            db: data.seats,
            min,
            max,
            preferred: !!rvaArr.find((x) => x.vehicle_id === vehId)?.preferred,
            groups: data.groups.sort((a, b) => b - a),
            assignee,
          });
        }

        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);

        if (!isT72orT24(horizon)) {
          for (const b of boats) {
            if (perBoat.find((x) => x.vehicle_id === b.vehicle_id)) continue;
            const v = vehicleById.get(b.vehicle_id);

            const a = assignByKey.get(`${j.id}_${b.vehicle_id}`);
            const assignee =
              a && a.staff_id
                ? {
                    staff_id: a.staff_id,
                    name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Unnamed",
                    status: a.status_simple,
                  }
                : undefined;

            perBoat.push({
              vehicle_id: b.vehicle_id,
              vehicle_name: v?.name ?? "Unknown",
              operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
              operator_id: v?.operator_id ?? null,
              db: 0,
              min: v?.minseats != null ? Number(v.minseats) : null,
              max: v?.maxseats != null ? Number(v.maxseats) : null,
              preferred: !!rvaArr.find((x) => x.vehicle_id)?.preferred,
              groups: [],
              assignee,
            });
          }
        } else {
          for (let i = perBoat.length - 1; i >= 0; i--) {
            if (perBoat[i].db <= 0) perBoat.splice(i, 1);
          }
        }
      } else {
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = previewAlloc.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;

          const a = assignByKey.get(`${j.id}_${b.vehicle_id}`);
          const assignee =
            a && a.staff_id
              ? {
                  staff_id: a.staff_id,
                  name: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim() || "Unnamed",
                  status: a.status_simple,
                }
              : undefined;

          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find((x) => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: (entry?.orders ?? []).map((o) => o.size).sort((a, b) => b - a),
            assignee,
          });
        }
        unassigned = previewAlloc.unassigned.reduce((s, u) => s + u.size, 0);

        if (isT72orT24(horizon)) {
          for (let i = perBoat.length - 1; i >= 0; i--) {
            if (perBoat[i].db <= 0) perBoat.splice(i, 1);
          }
        }
      }

      perBoat.sort((a, b) => {
        const ao = a.operator_name || "";
        const bo = b.operator_name || "";
        if (ao !== bo) return ao.localeCompare(bo);
        if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
        return a.vehicle_name.localeCompare(b.vehicle_name);
      });

      const atRiskBelowMin =
        isT72orT24(horizon) &&
        perBoat.some((b) => b.db > 0 && b.min != null && b.db < (b.min as number));

      out.push({
        journey: j,
        pickup: pickupNameById.get(r.pickup_id) ?? "—",
        destination: destNameById.get(r.destination_id) ?? "—",
        depDate: dep.toLocaleDateString(),
        depTime: dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        horizon,
        contextDay: ctxDay,
        isLocked,
        perBoat,
        totals: {
          proj: parties.reduce((s, p) => s + p.size, 0),
          dbTotal,
          maxTotal,
          unassigned,
        },
        previewAlloc,
        lockedAlloc: locked,
        parties,
        boats,
        atRiskBelowMin,
      });
    }

    const filtered =
      operatorFilter === "all"
        ? out
        : out
            .map((row) => ({
              ...row,
              perBoat: row.perBoat.filter(
                (b) =>
                  b.vehicle_id === "__unassigned__" ||
                  vehicles.find((v) => v.id === b.vehicle_id)?.operator_id ===
                    operatorFilter
              ),
            }))
            .filter((row) => row.perBoat.length > 0);

    filtered.sort(
      (a, b) =>
        new Date(a.journey.departure_ts).getTime() -
        new Date(b.journey.departure_ts).getTime()
    );

    return filtered;
  }, [
    journeys,
    routes,
    pickups,
    destinations,
    rvas,
    vehicles,
    operators,
    orders,
    locksByJourney,
    operatorFilter,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
    assignByKey,
  ]);

  /* ---------- Actions: Finalise / Unlock ---------- */

  async function lockJourney(row: UiRow) {
    if (!supabase) return;
    try {
      if (!row.parties?.length || !row.boats?.length) {
        alert("No data to finalise.");
        return;
      }

      if (row.horizon === "T72" && row.atRiskBelowMin) {
        setErr(
          "Cannot finalise at T-72: one or more boats would run below their minimum seats."
        );
        return;
      }

      let finalAlloc: DetailedAlloc;
      try {
        finalAlloc = allocateFinalT24(row.parties, row.boats);
      } catch (e: any) {
        setErr(`Cannot finalise: ${e?.message ?? String(e)}`);
        return;
      }

      if (finalAlloc.unassigned.length > 0) {
        setErr(
          "Cannot finalise: some groups could not be assigned within capacities."
        );
        return;
      }

      const allocToSave: {
        journey_id: UUID;
        vehicle_id: UUID;
        order_id: UUID;
        seats: number;
      }[] = [];
      for (const [vehId, data] of finalAlloc.byBoat.entries()) {
        for (const o of data.orders) {
          allocToSave.push({
            journey_id: row.journey.id,
            vehicle_id: vehId,
            order_id: o.order_id,
            seats: o.size,
          });
        }
      }

      const del = await supabase
        .from("journey_vehicle_allocations")
        .delete()
        .eq("journey_id", row.journey.id);
      if (del.error) throw del.error;

      if (allocToSave.length) {
        const ins = await supabase
          .from("journey_vehicle_allocations")
          .insert(allocToSave);
        if (ins.error) throw ins.error;
      }

      const { data: lockData, error: lockErr } = await supabase
        .from("journey_vehicle_allocations")
        .select("journey_id,vehicle_id,order_id,seats")
        .eq("journey_id", row.journey.id);
      if (lockErr) throw lockErr;

      setLocksByJourney((prev) => {
        const copy = new Map(prev);
        copy.set(row.journey.id, (lockData || []) as any);
        return copy;
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function unlockJourney(journeyId: UUID) {
    if (!supabase) return;
    try {
      const del = await supabase
        .from("journey_vehicle_allocations")
        .delete()
        .eq("journey_id", journeyId);
      if (del.error) throw del.error;

      setLocksByJourney((prev) => {
        const copy = new Map(prev);
        copy.delete(journeyId);
        return copy;
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  /* ---------- Crew: assign lead ---------- */
  async function onAssign(journeyId: UUID, vehicleId: UUID, staffId?: UUID) {
    const key = `${journeyId}_${vehicleId}`;
    setAssigning(key);

    // Helper to re-read the assignment view for this journey+vehicle
    const refreshView = async () => {
      const { data: aData } = await supabase!
        .from("v_crew_assignments_min")
        .select(
          "journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
        )
        .eq("journey_id", journeyId)
        .eq("vehicle_id", vehicleId);

      const updated = ((aData as AssignView[]) ?? []).filter(
        (r) => (r.role_label ?? "").toLowerCase() !== "crew"
      );

      setAssigns((prev) => {
        const m = new Map(prev.map((p) => [`${p.journey_id}_${p.vehicle_id}`, p]));
        updated.forEach((u) => m.set(`${u.journey_id}_${u.vehicle_id}`, u));
        return Array.from(m.values());
      });

      return updated.length > 0;
    };

    try {
      const res = await fetch("/api/ops/assign/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          journey_id: journeyId,
          vehicle_id: vehicleId,
          ...(staffId ? { staff_id: staffId } : {}),
        }),
      });

      let body: any = null;
      try {
        body = await res.json();
      } catch {}

      if (res.status === 409) {
        await refreshView();
        return;
      }

      if (res.status === 422) {
        alert(body?.error || "Captain unavailable");
        return;
      }

      if (!res.ok) {
        const msg = (body?.error || "").toLowerCase();
        const softReturnError =
          msg.includes("non-composite value") ||
          msg.includes("composite type") ||
          msg.includes("function does not exist") ||
          msg.includes("stack depth limit exceeded");

        if (softReturnError) {
          const ok = await refreshView();
          if (ok) return;
        }

        throw new Error(body?.error || `Assign failed (${res.status})`);
      }

      await refreshView();
    } catch (e: any) {
      alert(e?.message ?? "Assign failed");
    } finally {
      setAssigning(null);
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Site Admin — Live Journeys</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-700">Operator:</label>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={operatorFilter}
            onChange={(e) => setOperatorFilter((e.target.value || "all") as any)}
          >
            <option value="all">All operators</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <p className="text-neutral-600 text-sm">
        Future journeys only · Customers from paid orders · No DB writes (preview allocation) — use{" "}
        <strong>Finalise</strong> to run the T-24 shuffle and persist. Assign crew leads inline per
        boat.
      </p>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm mt-2">{err}</div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow mt-4">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow mt-4">
          No journeys with client assignments.
        </div>
      ) : (
        <div className="space-y-6 mt-4">
          {rows.map((row) => (
            <section
              key={row.journey.id}
              className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 flex flex-wrap items-center gap-3 border-b bg-neutral-50">
                <div className="text-lg font-medium">
                  {row.pickup} → {row.destination}
                </div>
                <div className="text-sm text-neutral-600">
                  {row.depDate} · {row.depTime}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  {row.horizon === "T24" ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs">
                      T-24 (Final window)
                    </span>
                  ) : row.horizon === "T72" ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        row.atRiskBelowMin ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {row.atRiskBelowMin ? "T-72 (At risk: below min)" : "T-72 (Confirm window)"}
                    </span>
                  ) : row.horizon === ">72h" ? (
                    <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">
                      &gt;72h (Prep)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">
                      Past
                    </span>
                  )}

                  {row.contextDay === "today" && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs">
                      Runs Today
                    </span>
                  )}
                  {row.contextDay === "tomorrow" && (
                    <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-xs">
                      Runs Tomorrow
                    </span>
                  )}

                  <span className="text-xs text-neutral-700">
                    Proj: <strong>{row.totals.proj}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Customers: <strong>{row.totals.dbTotal}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Max: <strong>{row.totals.maxTotal}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Unassigned: <strong>{row.totals.unassigned}</strong>
                  </span>

                  {(row.horizon === "T24" || row.horizon === "T72") &&
                    (row.isLocked ? (
                      <>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                          Locked
                        </span>
                        <button
                          className="text-xs px-3 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-100"
                          onClick={() => unlockJourney(row.journey.id)}
                          title="Remove persisted allocation for this journey"
                        >
                          Unlock
                        </button>
                      </>
                    ) : (
                      <button
                        className={`text-xs px-3 py-1 rounded-lg border ${
                          row.horizon === "T72" && row.atRiskBelowMin
                            ? "border-neutral-300 text-neutral-400 cursor-not-allowed"
                            : "border-blue-600 text-blue-600 hover:bg-blue-50"
                        }`}
                        onClick={() => {
                          if (row.horizon === "T72" && row.atRiskBelowMin) return;
                          lockJourney(row);
                        }}
                        title={
                          row.horizon === "T72" && row.atRiskBelowMin
                            ? "Below min — cannot confirm at T-72"
                            : "Run the T-24 final shuffle and persist allocation"
                        }
                        disabled={row.horizon === "T72" && row.atRiskBelowMin}
                      >
                        Finalise
                      </button>
                    ))}
                </div>
              </div>

              {/* Boats */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left p-3">Boat</th>
                      <th className="text-left p-3">Operator</th>
                      <th className="text-right p-3">Customers</th>
                      <th className="text-right p-3">Min</th>
                      <th className="text-right p-3">Max</th>
                      <th className="text-left p-3">Groups</th>
                      <th className="text-left p-3">Lead</th>
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.perBoat.map((b) => {
                      const key = `${row.journey.id}_${b.vehicle_id}`;
                      const selected = selectedStaff[key];

                      const staffOptions =
                        (b.operator_id && staffByOperator.get(b.operator_id)) || [];

                      const currentLead = b.assignee?.name ?? null;
                      const canAssign = row.horizon === "T72" || row.horizon === ">72h";

                      return (
                        <tr key={key} className="border-t align-top">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{b.vehicle_name}</span>
                              {b.preferred && b.vehicle_name !== "Unassigned" && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                  preferred
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">{b.operator_name}</td>
                          <td className="p-3 text-right">{b.db}</td>
                          <td className="p-3 text-right">{b.min ?? "—"}</td>
                          <td className="p-3 text-right">{b.max ?? "—"}</td>
                          <td className="p-3">
                            {b.groups.length === 0 ? (
                              <span className="text-neutral-400">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {b.groups.map((g, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center justify-center rounded-lg border px-2 text-xs"
                                    style={{ minWidth: 24, height: 24 }}
                                  >
                                    {g}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* Lead cell */}
                          <td className="p-3">
                            {currentLead ? (
                              <div className="flex items-center gap-2">
                                <span
                                  className="px-2 py-1 rounded text-xs"
                                  style={{ background: "#dcfce7", color: "#166534" }}
                                >
                                  {b.assignee?.status === "confirmed"
                                    ? "Confirmed — "
                                    : "Assigned — "}
                                  {currentLead}
                                </span>
                              </div>
                            ) : canAssign ? (
                              <div className="flex items-center gap-2">
                                {staffOptions.length <= 1 ? (
                                  <span className="text-xs">
                                    {staffOptions[0]
                                      ? `${staffOptions[0].first_name ?? ""} ${
                                          staffOptions[0].last_name ?? ""
                                        }`.trim()
                                      : "No staff"}
                                  </span>
                                ) : (
                                  <select
                                    className="border rounded px-2 py-1 text-xs"
                                    value={selected || ""}
                                    onChange={(e) =>
                                      setSelectedStaff((prev) => ({
                                        ...prev,
                                        [key]: e.target.value as UUID,
                                      }))
                                    }
                                  >
                                    <option value="">Select crew…</option>
                                    {staffOptions.map((s) => {
                                      const name =
                                        `${s.last_name ?? ""} ${s.first_name ?? ""}`.trim() ||
                                        "Unnamed";
                                      return (
                                        <option key={s.id} value={s.id}>
                                          {name}
                                        </option>
                                      );
                                    })}
                                  </select>
                                )}
                                <button
                                  className="px-2 py-1 rounded text-xs text-white disabled:opacity-40"
                                  style={{ backgroundColor: "#111827" }}
                                  disabled={
                                    assigning === key ||
                                    (!selected && staffOptions.length !== 1)
                                  }
                                  onClick={() =>
                                    onAssign(
                                      row.journey.id,
                                      b.vehicle_id as UUID,
                                      (staffOptions.length === 1 && !selected
                                        ? staffOptions[0]?.id
                                        : selected) as UUID | undefined
                                    )
                                  }
                                >
                                  {assigning === key ? "Assigning…" : "Assign"}
                                </button>
                              </div>
                            ) : (
                              <span className="text-neutral-400 text-xs">—</span>
                            )}
                          </td>

                          <td className="p-3">
                            {(row.horizon === "T24" || row.horizon === "T72") &&
                            b.vehicle_id !== "__unassigned__" ? (
                              <button
                                className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                                style={{ backgroundColor: "#2563eb" }}
                                onClick={() =>
                                  (window.location.href = `/admin/manifest?journey=${row.journey.id}&vehicle=${b.vehicle_id}`)
                                }
                              >
                                Manifest
                              </button>
                            ) : (
                              <span className="text-neutral-400 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
