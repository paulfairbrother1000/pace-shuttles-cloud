// src/app/admin/page.tsx
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
  name: string | null;
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

type StaffMin = {
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID | null;
  status_simple: "allocated" | "confirmed" | "complete" | "cancelled" | null;
  first_name: string | null;
  last_name: string | null;
};

type StaffRow = {
  id: UUID;
  operator_id: UUID;
  active: boolean | null;
  first_name: string | null;
  last_name: string | null;
  jobrole: string | null;
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

type Horizon = "T24" | "T72" | ">72h" | "past";
function horizonFor(tsISO: string): Horizon {
  const now = new Date();
  const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (h < 24) return "T24";
  if (h < 72) return "T72";
  return ">72h";
}

function isT72orT24(h: Horizon) {
  return h === "T24" || h === "T72";
}

/* ---------- Simple allocator for >72h preview ONLY ---------- */
type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  preferred: boolean;
  min: number;
  max: number;
  operator_id?: UUID | null;
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

function allocateDetailed(parties: Party[], boats: Boat[]): DetailedAlloc {
  const boatsSorted = [...boats].sort((a, b) => {
    if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
    const am = a.max ?? 0;
    const bm = b.max ?? 0;
    if (am !== bm) return am - bm;
    return a.vehicle_id.localeCompare(b.vehicle_id);
  });

  type W = { def: Boat; used: number; groups: { order_id: UUID; size: number }[] };
  const work = new Map<UUID, W>();
  boatsSorted.forEach(b => work.set(b.vehicle_id, { def: b, used: 0, groups: [] }));

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
    .filter(p => p.size > 0)
    .sort((a, b) => b.size - a.size);

  // seed to min
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const cand = boatsSorted.find(b => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return w.used < b.min && free >= g.size;
      });
      if (cand) bump(cand.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // fill to max
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const cand = boatsSorted.find(b => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return free >= g.size;
      });
      if (cand) bump(cand.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  const total = parties.reduce((s, p) => s + (p.size || 0), 0);
  return { byBoat, unassigned: remaining, total };
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
  const [locksByJourney, setLocksByJourney] = useState<Map<UUID, JVALockRow[]>>(new Map());
  const [staffMinByJV, setStaffMinByJV] = useState<Map<string, StaffMin>>(new Map());
  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  // modal state
  const [assignOpen, setAssignOpen] = useState<{
    journey?: Journey;
    vehicle?: Vehicle;
  } | null>(null);
  const [eligible, setEligible] = useState<StaffRow[] | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

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
        const routeIds = Array.from(new Set(js.map(j => j.route_id)));
        const journeyIds = js.map(j => j.id);

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

        // 4) paid orders in date window
        const dateSet = new Set(js.map(j => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // 5) persisted locks for these journeys
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

        // 6) staff min (pill)
        if (journeyIds.length) {
          const { data: sm, error: smErr } = await supabase
            .from("v_journey_staff_min")
            .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
            .in("journey_id", journeyIds);
          if (smErr) throw smErr;
          const m = new Map<string, StaffMin>();
          (sm || []).forEach((r: any) => {
            m.set(`${r.journey_id}_${r.vehicle_id}`, r as StaffMin);
          });
          setStaffMinByJV(m);
        } else {
          setStaffMinByJV(new Map());
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
    routes.forEach(r => m.set(r.id, r));
    return m;
  }, [routes]);

  const pickupNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    pickups.forEach(p => m.set(p.id, p.name));
    return m;
  }, [pickups]);

  const destNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    destinations.forEach(d => m.set(d.id, d.name));
    return m;
  }, [destinations]);

  const vehicleById = useMemo(() => {
    const m = new Map<UUID, Vehicle>();
    vehicles.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const operatorNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    operators.forEach(o => m.set(o.id, o.name || "—"));
    return m;
  }, [operators]);

  /* ---------- UI Rows ---------- */
  type UiBoat = {
    vehicle_id: UUID | "__unassigned__";
    vehicle_name: string;
    operator_name: string;
    db: number;                   // customers on this boat
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];             // group sizes (chips)
    staff?: StaffMin | null;      // pill
  };

  type UiRow = {
    journey: Journey;
    pickup: string;
    destination: string;
    depDate: string;
    depTime: string;
    horizon: Horizon;
    isLocked: boolean;
    perBoat: UiBoat[];
    totals: {
      proj: number;       // total pax from orders
      dbTotal: number;    // sum on actual boats (excl unassigned)
      maxTotal: number;   // sum of max seats across boats
      unassigned: number; // pax not fitting (preview mode only)
    };
    previewAlloc?: DetailedAlloc;
    parties?: Party[];
    boats?: Boat[];
  };

  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length) return [];

    // Group orders by (route_id, journey_date)
    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const k = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(k) ?? [];
      arr.push(o);
      ordersByKey.set(k, arr);
    }

    // Group RVAs by route
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

      const oArr = ordersByKey.get(`${j.route_id}_${dateISO}`) ?? [];
      const parties: Party[] = oArr
        .map(o => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter(g => g.size > 0);

      if (!parties.length) continue; // skip journeys with no customers

      // Candidate boats
      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter(x => x.is_active);
      const boats: Boat[] = rvaArr
        .map(x => {
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
          };
        })
        .filter(Boolean) as Boat[];

      // build from persisted rows if any
      const locked = locksByJourney.get(j.id) ?? [];
      const isLocked = locked.length > 0;

      const perBoat: UiBoat[] = [];
      let dbTotal = 0;
      let unassigned = 0;

      if (isLocked || isT72orT24(horizon)) {
        // Build from JVA; hide zero boats at T-72/T-24
        const groupByVeh = new Map<UUID, { seats: number; groups: number[] }>();
        for (const row of locked) {
          const cur = groupByVeh.get(row.vehicle_id) ?? { seats: 0, groups: [] };
          cur.seats += Number(row.seats || 0);
          cur.groups.push(Number(row.seats || 0));
          groupByVeh.set(row.vehicle_id, cur);
        }
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const g = groupByVeh.get(b.vehicle_id) ?? { seats: 0, groups: [] };
          if (isT72orT24(horizon) && g.seats <= 0) continue;
          dbTotal += g.seats;
          const pill = staffMinByJV.get(`${j.id}_${b.vehicle_id}`) || null;
          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            db: g.seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: g.groups.sort((a, b) => b - a),
            staff: pill,
          });
        }
      } else {
        // >72h preview only
        const previewAlloc = allocateDetailed(parties, boats);
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = previewAlloc.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;
          const pill = staffMinByJV.get(`${j.id}_${b.vehicle_id}`) || null;
          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: (entry?.orders ?? []).map(o => o.size).sort((a, b) => b - a),
            staff: pill,
          });
        }
        unassigned = previewAlloc.unassigned.reduce((s, u) => s + u.size, 0);
      }

      // Sort: by operator name, then preferred, then boat
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
        isLocked,
        perBoat,
        totals: {
          proj: parties.reduce((s, p) => s + p.size, 0),
          dbTotal,
          maxTotal: boats.reduce((s, b) => s + b.max, 0),
          unassigned,
        },
        parties,
        boats,
      });
    }

    // Operator filter (keep journeys with at least one row for that operator)
    const filtered =
      operatorFilter === "all"
        ? out
        : out
            .map(row => ({
              ...row,
              perBoat: row.perBoat.filter(
                b =>
                  b.vehicle_id === "__unassigned__" ||
                  vehicles.find(v => v.id === b.vehicle_id)?.operator_id === operatorFilter
              ),
            }))
            .filter(row => row.perBoat.length > 0);

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
    staffMinByJV,
    operatorFilter,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
  ]);

  /* ---------- Actions ---------- */

  async function refreshOneJourneyJVA(journeyId: UUID) {
    if (!supabase) return;
    const { data: lockData, error: lockErr } = await supabase
      .from("journey_vehicle_allocations")
      .select("journey_id,vehicle_id,order_id,seats")
      .eq("journey_id", journeyId);
    if (lockErr) throw lockErr;
    setLocksByJourney(prev => {
      const copy = new Map(prev);
      copy.set(journeyId, (lockData || []) as any);
      return copy;
    });

    const { data: sm, error: smErr } = await supabase
      .from("v_journey_staff_min")
      .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
      .eq("journey_id", journeyId);
    if (smErr) throw smErr;
    setStaffMinByJV(prev => {
      const copy = new Map(prev);
      (sm || []).forEach((r: any) => copy.set(`${r.journey_id}_${r.vehicle_id}`, r as StaffMin));
      return copy;
    });
  }

  async function finalizeJourney(journeyId: UUID, operatorId?: UUID) {
    setErr(null);
    try {
      const res = await fetch("/api/ops/finalize-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          operatorId ? { journey_id: journeyId, operator_id: operatorId } : { journey_id: journeyId }
        ),
      }).then(r => r.json());
      if (!res?.ok) throw new Error(res?.error || "Finalize failed");
      await refreshOneJourneyJVA(journeyId);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function openAssignModal(journey: Journey, vehicleId: UUID) {
    if (!supabase) return;
    const v = vehicleById.get(vehicleId);
    if (!v?.operator_id) {
      setEligible([]);
      setAssignOpen({ journey, vehicle: v || undefined });
      return;
    }
    const { data, error } = await supabase
      .from("operator_staff")
      .select("id,operator_id,active,first_name,last_name,jobrole")
      .eq("operator_id", v.operator_id)
      .eq("active", true);
    if (error) {
      setErr(error.message);
      return;
    }
    const leadRoles = new Set(["captain", "pilot", "driver"]);
    const list = (data || []).filter(s => leadRoles.has(String(s.jobrole || "").toLowerCase()));
    setEligible(list as StaffRow[]);
    setAssignOpen({ journey, vehicle: v || undefined });
  }

  async function assignLead(staff_id: UUID) {
    if (!assignOpen?.journey || !assignOpen?.vehicle) return;
    setAssignBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/ops/assign-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: assignOpen.journey.id,
          vehicle_id: assignOpen.vehicle.id,
          staff_id,
          mode: "manual",
        }),
      }).then(r => r.json());
      if (!res?.ok) throw new Error(res?.error || "Assign failed");
      await refreshOneJourneyJVA(assignOpen.journey.id);
      setAssignOpen(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setAssignBusy(false);
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operator Admin — Live Journeys</h1>
          <p className="text-neutral-600 text-sm">
            Persisted manifest at T-72/T-24. Use <strong>Recalculate</strong> to apply T-72 rules; use{" "}
            <strong>Assign</strong> to set or replace a lead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-700">Operator:</label>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={operatorFilter}
            onChange={e => setOperatorFilter((e.target.value || "all") as any)}
          >
            <option value="all">All operators</option>
            {operators.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
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
          No journeys with client assignments.
        </div>
      ) : (
        <div className="space-y-6">
          {rows.map(row => (
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
                  {row.horizon === ">72h" && (
                    <span className="text-xs text-neutral-700">
                      Unassigned: <strong>{row.totals.unassigned}</strong>
                    </span>
                  )}

                  {/* Recalculate */}
                  {row.horizon !== "past" && (
                    <button
                      className="text-xs px-3 py-1 rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50"
                      onClick={() =>
                        finalizeJourney(
                          row.journey.id,
                          operatorFilter === "all" ? undefined : (operatorFilter as UUID)
                        )
                      }
                      title="Apply T-72 rules and persist manifest for this journey"
                    >
                      Recalculate
                    </button>
                  )}
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
                      <th className="text-left p-3">Status</th>
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.perBoat.map(b => (
                      <tr key={`${row.journey.id}_${b.vehicle_id}`} className="border-t align-top">
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
                        <td className="p-3">
                          {b.staff?.staff_id ? (
                            <span className="text-blue-700 underline">
                              {b.staff.first_name} {b.staff.last_name}
                              {b.staff.status_simple === "confirmed" ? " (confirmed)" : ""}
                            </span>
                          ) : (
                            <span className="text-neutral-500">Needs crew</span>
                          )}
                        </td>
                        <td className="p-3">
                          {b.vehicle_id !== "__unassigned__" ? (
                            <div className="flex gap-2">
                              {(row.horizon === "T24" || row.horizon === "T72" || row.horizon === ">72h") && (
                                <button
                                  className="px-3 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-100"
                                  onClick={() => openAssignModal(row.journey, b.vehicle_id as UUID)}
                                  title={b.staff?.staff_id ? "Replace lead" : "Assign lead"}
                                >
                                  {b.staff?.staff_id ? "Replace" : "Assign"}
                                </button>
                              )}
                              {(row.horizon === "T24" || row.horizon === "T72") && (
                                <button
                                  className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                                  style={{ backgroundColor: "#2563eb" }}
                                  onClick={() =>
                                    (window.location.href = `/admin/manifest?journey=${row.journey.id}&vehicle=${b.vehicle_id}`)
                                  }
                                >
                                  Manifest
                                </button>
                              )}
                            </div>
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
      {assignOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-4 w-[480px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Assign lead</h3>
              <button
                className="text-neutral-500 hover:text-black"
                onClick={() => setAssignOpen(null)}
                disabled={assignBusy}
              >
                ✕
              </button>
            </div>
            {!eligible ? (
              <div className="text-sm text-neutral-600">Loading eligible crew…</div>
            ) : eligible.length === 0 ? (
              <div className="text-sm text-rose-700">
                No eligible captains/pilots/drivers for this boat’s operator.
              </div>
            ) : (
              <div className="max-h-72 overflow-auto divide-y">
                {eligible.map(s => (
                  <button
                    key={s.id}
                    disabled={assignBusy}
                    className="w-full text-left py-2 hover:bg-neutral-50 px-2 disabled:opacity-50"
                    onClick={() => assignLead(s.id)}
                  >
                    <div className="font-medium">
                      {s.first_name} {s.last_name}
                    </div>
                    <div className="text-xs text-neutral-500">{s.jobrole}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button
                className="px-3 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-100"
                onClick={() => setAssignOpen(null)}
                disabled={assignBusy}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
