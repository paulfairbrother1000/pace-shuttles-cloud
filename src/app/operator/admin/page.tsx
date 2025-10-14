// /src/app/operator/admin/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type CrewMinRow = {
  assignment_id: UUID;
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID;
  status_simple: string | null;
  first_name: string | null;
  last_name: string | null;
  role_label: string | null; // "Captain"/etc from your view
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

/* ---------- Allocation preview (unchanged core) ---------- */
type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  preferred: boolean;

  min: number; // min seats
  max: number; // cap
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
  type W = { def: Boat; used: number; groups: { order_id: UUID; size: number }[] };
  const work = new Map<UUID, W>();
  boatsSorted.forEach((b) => work.set(b.vehicle_id, { def: b, used: 0, groups: [] }));

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

  // Phase A — seed to MIN
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const candidate = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return w.used < b.min && free >= g.size;
      });
      if (candidate) bump(candidate.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // Phase B — fill to MAX
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const candidate = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return free >= g.size;
      });
      if (candidate) bump(candidate.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  for (const g of remaining) unassigned.push({ order_id: g.order_id, size: g.size });

  // T-72 rebalance minimalism (keep <=1 under-min)
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
        pick = g;
        break;
      }
      if (!pick) return false;
      donor.used -= pick.size;
      receiver.used += pick.size;
      const di = donor.groups.findIndex((x) => x.order_id === pick!.order_id && x.size === pick!.size);
      if (di >= 0) donor.groups.splice(di, 1);
      receiver.groups.push(pick);
      const dMap = byBoat.get(donor.def.vehicle_id)!;
      const rMap = byBoat.get(receiver.def.vehicle_id) ?? { seats: 0, orders: [] };
      dMap.seats -= pick.size;
      const boIdx = dMap.orders.findIndex((x) => x.order_id === pick!.order_id && x.size === pick!.size);
      if (boIdx >= 0) dMap.orders.splice(boIdx, 1);
      rMap.seats += pick.size;
      rMap.orders.push(pick);
      byBoat.set(receiver.def.vehicle_id, rMap);
      return true;
    };

    let changed = true;
    while (changed) {
      changed = false;
      const receivers = underMin().sort((a, b) => b.def.min - a.def.min);
      if (!receivers.length) break;
      for (const recv of receivers) {
        const donors = overMin().sort((a, b) => (b.used - b.def.min) - (a.used - a.def.min));
        for (const don of donors) {
          if (tryMove(don, recv)) {
            changed = true;
            break;
          }
        }
      }
    }
  }

  const total = parties.reduce((s, p) => s + (p.size || 0), 0);
  return { byBoat, unassigned, total };
}

/* ---------- Page ---------- */
export default function OperatorAdminPage() {
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
  const [locksByJourney, setLocksByJourney] = useState<Map<UUID, JVALockRow[]>>(new Map());

  // Captains loaded from view (lead per journey/vehicle)
  const [captainByJV, setCaptainByJV] = useState<Map<string, CrewMinRow>>(new Map());

  // Assign modal state
  const [assigning, setAssigning] = useState<{ journeyId: UUID; vehicleId: UUID } | null>(null);
  const [capCandidates, setCapCandidates] = useState<Array<{ staff_id: UUID; name: string; email: string | null; priority: number; recent: number }>>([]);
  const [capBusy, setCapBusy] = useState(false);

  const realtimeRef = useRef<any>(null);

  /* ---------- Initial load ---------- */
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
        // future & active journeys
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

        // lookups
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

        // RVAs, vehicles, operators
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

        // orders (paid)
        const dateSet = new Set(js.map((j) => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // allocations
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

        // current captain leads from view API (per journey)
        await refreshCaptainsBulk(journeyIds);
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

  /* ---------- helpers: lookups ---------- */
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

  /* ---------- Captain refresh + auto-assign ---------- */

  async function refreshCaptainsBulk(journeyIds: UUID[]) {
    try {
      const newMap = new Map<string, CrewMinRow>();
      for (const jid of journeyIds) {
        const res = await fetch("/api/ops/crew/list?journey_id=" + jid, { method: "GET" });
        const js = await res.json();
        const rows: CrewMinRow[] = (js?.data || []).filter((r: any) => (r.role_label || "").toLowerCase().includes("capt"));
        for (const r of rows) {
          const key = `${r.journey_id}_${r.vehicle_id}`;
          newMap.set(key, r);
        }
      }
      setCaptainByJV(newMap);

      // Fire auto-assign for empty boats
      await autoAssignMissingCaptains();
    } catch (e: any) {
      console.warn("captain refresh failed", e?.message || e);
    }
  }

  async function refreshCaptainsOne(journeyId: UUID) {
    try {
      const res = await fetch("/api/ops/crew/list?journey_id=" + journeyId, { method: "GET" });
      const js = await res.json();
      const rows: CrewMinRow[] = (js?.data || []).filter((r: any) => (r.role_label || "").toLowerCase().includes("capt"));

      setCaptainByJV((prev) => {
        const copy = new Map(prev);
        // clear existing keys for this journey
        for (const k of [...copy.keys()]) {
          if (k.startsWith(journeyId + "_")) copy.delete(k);
        }
        rows.forEach((r) => copy.set(`${r.journey_id}_${r.vehicle_id}`, r));
        return copy;
      });

      await autoAssignMissingCaptains([journeyId]);
    } catch (e: any) {
      console.warn("captain refresh (one) failed", e?.message || e);
    }
  }

  async function autoAssignMissingCaptains(scopeJourneyIds?: UUID[]) {
    // build current rows to find missing captain per (journey,vehicle)
    const targetJourneyIds = scopeJourneyIds ?? journeys.map((j) => j.id);

    // Build candidate boats per journey from RVAs
    const rvasByRoute = new Map<UUID, RVA[]>();
    for (const r of rvas) {
      if (!r.is_active) continue;
      const arr = rvasByRoute.get(r.route_id) ?? [];
      arr.push(r);
      rvasByRoute.set(r.route_id, arr);
    }

    for (const j of journeys.filter((jj) => targetJourneyIds.includes(jj.id))) {
      const r = routeById.get(j.route_id);
      if (!r) continue;
      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter((x) => x.is_active);

      for (const rv of rvaArr) {
        const veh = vehicleById.get(rv.vehicle_id);
        if (!veh || veh.active === false) continue;
        const key = `${j.id}_${veh.id}`;
        const haveCaptain = captainByJV.has(key);
        if (!haveCaptain) {
          // call /api/ops/auto-assign
          try {
            const res = await fetch("/api/ops/auto-assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ journeyId: j.id, vehicleId: veh.id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              console.warn("auto-assign failed", res.status, data?.error || data);
            } else {
              // refresh captain list if assignment happened
              if (data?.assigned || data?.captainAssigned) {
                await refreshCaptainsOne(j.id);
              }
            }
          } catch (e: any) {
            console.warn("auto-assign error", e?.message || e);
          }
        }
      }
    }
  }

  /* ---------- Realtime: watch for new bookings/allocations ---------- */
  useEffect(() => {
    if (!supabase || journeys.length === 0) return;

    // clean previous
    if (realtimeRef.current) {
      realtimeRef.current.unsubscribe?.();
      realtimeRef.current = null;
    }

    // Watch order payments & journey_vehicle_allocations updates; refetch captains for affected journey
    const channel = supabase
      .channel("ops-operator-admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "journey_vehicle_allocations" },
        (payload) => {
          const row = (payload.new || payload.old) as any;
          if (row?.journey_id) refreshCaptainsOne(row.journey_id as UUID);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const row = payload.new as any;
          // we don’t know journey_id directly from orders; refresh all, cheap enough
          if (row?.status === "paid") refreshCaptainsBulk(journeys.map((j) => j.id));
        }
      )
      .subscribe();

    realtimeRef.current = channel;

    return () => {
      channel.unsubscribe();
      realtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, journeys.length]);

  /* ---------- UI rows ---------- */
  type UiBoat = {
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    db: number;
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
    captain?: { name: string; staff_id: UUID } | null;
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
  };

  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length) return [];

    // orders grouped
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

      // show journeys even if 0 customers (to allow captain assignment prep)
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

      const previewAlloc = allocateDetailed(parties, boats, { horizon });
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

          const key = `${j.id}_${vehId}`;
          const cap = captainByJV.get(key);
          const capName = cap ? [cap.first_name, cap.last_name].filter(Boolean).join(" ") : null;

          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—",
            db: data.seats,
            min,
            max,
            preferred: !!rvaArr.find((x) => x.vehicle_id === vehId)?.preferred,
            groups: data.groups.sort((a, b) => b - a),
            captain: cap ? { name: capName || "—", staff_id: cap.staff_id } : null,
          });
        }

        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);
      } else {
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = previewAlloc.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;

          const key = `${j.id}_${b.vehicle_id}`;
          const cap = captainByJV.get(key);
          const capName = cap ? [cap.first_name, cap.last_name].filter(Boolean).join(" ") : null;

          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find((x) => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: (entry?.orders ?? []).map((o) => o.size).sort((a, b) => b - a),
            captain: cap ? { name: capName || "—", staff_id: cap.staff_id } : null,
          });
        }
        unassigned = previewAlloc.unassigned.reduce((s, u) => s + u.size, 0);
      }

      // At T-72/T-24 hide zero-customer boats (release)
      if (isT72orT24(horizon)) {
        for (let i = perBoat.length - 1; i >= 0; i--) {
          if (perBoat[i].db <= 0) perBoat.splice(i, 1);
        }
      }

      // sort
      perBoat.sort((a, b) => {
        const ao = a.operator_name || "";
        const bo = b.operator_name || "";
        if (ao !== bo) return ao.localeCompare(bo);
        if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
        return a.vehicle_name.localeCompare(b.vehicle_name);
      });

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
      });
    }

    out.sort(
      (a, b) =>
        new Date(a.journey.departure_ts).getTime() -
        new Date(b.journey.departure_ts).getTime()
    );
    return out;
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
    captainByJV,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
  ]);

  /* ---------- Lock / Unlock ---------- */
  async function lockJourney(row: UiRow) {
    if (!supabase) return;
    try {
      const allocToSave: { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number }[] = [];
      if (row.previewAlloc && row.parties && row.boats) {
        for (const [vehId, data] of row.previewAlloc.byBoat.entries()) {
          for (const o of data.orders) {
            allocToSave.push({
              journey_id: row.journey.id,
              vehicle_id: vehId,
              order_id: o.order_id,
              seats: o.size,
            });
          }
        }
      } else {
        alert("No preview allocation available to lock.");
        return;
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

      // after lock, also re-check captains in case boats changed
      await refreshCaptainsOne(row.journey.id);
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

      await refreshCaptainsOne(journeyId);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  /* ---------- Manual Assign flow ---------- */
  async function openAssign(journeyId: UUID, vehicleId: UUID) {
    setAssigning({ journeyId, vehicleId });
    setCapBusy(true);
    try {
      const res = await fetch("/api/ops/captain-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId }),
      });
      const js = await res.json();
      setCapCandidates(js?.items || []);
    } catch (e: any) {
      setCapCandidates([]);
      console.warn("candidate load failed", e?.message || e);
    } finally {
      setCapBusy(false);
    }
  }

  async function assignCaptain(staffId: UUID) {
    if (!assigning) return;
    setCapBusy(true);
    try {
      const res = await fetch("/api/ops/assign/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId: assigning.journeyId, staffId }),
      });
      const js = await res.json();
      if (!res.ok) {
        alert("Assign failed: " + (js?.error || res.statusText));
      } else {
        setAssigning(null);
        await refreshCaptainsOne(assigning.journeyId);
      }
    } catch (e: any) {
      alert("Assign failed: " + (e?.message || String(e)));
    } finally {
      setCapBusy(false);
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operator dashboard — Live Journeys</h1>
          <p className="text-neutral-600 text-sm">
            Future journeys only · Customers from paid orders · Preview matches server policy — use <strong>Lock</strong> to persist.
          </p>
        </div>
        <div />
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow">
          No journeys.
        </div>
      ) : (
        <div className="space-y-6">
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
                  {/* Horizon badge */}
                  {row.horizon === "T24" ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs">
                      T-24 (Finalised)
                    </span>
                  ) : row.horizon === "T72" ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">
                      T-72 (Confirmed)
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

                  {/* Context awareness */}
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

                  {/* Totals */}
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">Locked</span>
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
                        className="text-xs px-3 py-1 rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50"
                        onClick={() => lockJourney(row)}
                        title="Persist the current preview allocation"
                      >
                        Lock
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
                      <th className="text-left p-3">Captain</th>
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.perBoat.map((b) => (
                      <tr key={`${row.journey.id}_${b.vehicle_id}`} className="border-t align-top">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{b.vehicle_name}</span>
                            {b.preferred && (
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
                        <td className="p-3">
                          {b.captain ? (
                            <div className="flex items-center gap-2">
                              <span>{b.captain.name}</span>
                              <button
                                className="text-xs underline text-blue-600"
                                onClick={() => openAssign(row.journey.id, b.vehicle_id)}
                              >
                                change
                              </button>
                            </div>
                          ) : (
                            <button
                              className="text-xs underline text-blue-600"
                              onClick={() => openAssign(row.journey.id, b.vehicle_id)}
                              title="Assign a captain"
                            >
                              Assign
                            </button>
                          )}
                        </td>
                        <td className="p-3">
                          {(row.horizon === "T24" || row.horizon === "T72") ? (
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
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Assign modal */}
      {assigning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-4 w-[520px]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Assign captain</h3>
              <button
                className="text-sm text-neutral-600 hover:text-black"
                onClick={() => setAssigning(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-3">
              {capBusy ? (
                <div className="text-sm text-neutral-600">Loading candidates…</div>
              ) : capCandidates.length === 0 ? (
                <div className="text-sm text-neutral-600">No candidates available.</div>
              ) : (
                <ul className="divide-y">
                  {capCandidates.map((c) => (
                    <li key={c.staff_id} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-neutral-600">
                          Priority {c.priority} · recent assignments {c.recent}
                          {c.email ? <> · {c.email}</> : null}
                        </div>
                      </div>
                      <button
                        className="px-3 py-1 rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50 text-sm"
                        onClick={() => assignCaptain(c.staff_id)}
                      >
                        Select
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
