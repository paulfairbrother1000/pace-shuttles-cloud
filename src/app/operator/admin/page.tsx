// /src/app/operator/admin/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

/* ---------- DB Shapes ---------- */
type Journey = {
  id: UUID;
  route_id: UUID;
  departure_ts: string; // ISO
  is_active: boolean;
};

type Route = { id: UUID; pickup_id: UUID; destination_id: UUID };
type Pickup = { id: UUID; name: string };
type Destination = { id: UUID; name: string };

type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean | null };

type Vehicle = {
  id: UUID;
  name: string | null;
  active: boolean | null;
  minseats: number | string | null;
  maxseats: number | string | null;
  operator_id: UUID | null;
};

type Operator = { id: UUID; name: string | null };

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
  vehicle_id: UUID | null;
  staff_id: UUID | null;
  status_simple: string | null;
  first_name: string | null;
  last_name: string | null;
  role_label: string | null;
};

/* ---------- Supabase (browser) ---------- */
const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Utils ---------- */
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
  const h = (dep.getTime() - now.getTime()) / 36e5;
  if (h < 24) return "T24";
  if (h < 72) return "T72";
  return ">72h";
}
const isTWindow = (h: Horizon) => h === "T24" || h === "T72";

/* ---------- Allocation preview (client-side only, unchanged policy) ---------- */
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

function allocateDetailed(parties: Party[], boats: Boat[], horizon: Horizon): DetailedAlloc {
  const boatsSorted = [...boats].sort((a, b) => {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    if (a.max !== b.max) return a.max - b.max;
    return a.vehicle_id.localeCompare(b.vehicle_id);
  });

  type W = { def: Boat; used: number; groups: { order_id: UUID; size: number }[] };
  const work = new Map<UUID, W>();
  boatsSorted.forEach((b) => work.set(b.vehicle_id, { def: b, used: 0, groups: [] }));

  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  const bump = (vid: UUID, order_id: UUID, size: number) => {
    const w = work.get(vid)!;
    w.used += size;
    w.groups.push({ order_id, size });
    const cur = byBoat.get(vid) ?? { seats: 0, orders: [] as { order_id: UUID; size: number }[] };
    cur.seats += size;
    cur.orders.push({ order_id, size });
    byBoat.set(vid, cur);
  };

  const remaining = [...parties].filter((p) => p.size > 0).sort((a, b) => b.size - a.size);
  const unassigned: { order_id: UUID; size: number }[] = [];

  // A) seed to MIN
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const c = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return w.used < b.min && free >= g.size;
      });
      if (c) bump(c.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // B) fill up to MAX
  {
    const next: Party[] = [];
    for (const g of remaining) {
      const c = boatsSorted.find((b) => {
        const w = work.get(b.vehicle_id)!;
        const free = b.max - w.used;
        return free >= g.size;
      });
      if (c) bump(c.vehicle_id, g.order_id, g.size);
      else next.push(g);
    }
    remaining.length = 0;
    remaining.push(...next);
  }

  // Leftovers cannot fit
  for (const g of remaining) unassigned.push({ order_id: g.order_id, size: g.size });

  // T-72 balancing: keep at most one under-min boat
  if (horizon === "T72") {
    const active = () => [...work.values()].filter((w) => w.used > 0);
    const under = () => active().filter((w) => w.used < w.def.min);
    while (under().length > 1) {
      const src = under().sort((a, b) => a.used - b.used)[0];
      if (!src) break;
      let moved = false;
      for (const g of [...src.groups].sort((a, b) => a.size - b.size)) {
        const tgt = active()
          .filter((w) => w.def.vehicle_id !== src.def.vehicle_id)
          .sort((a, b) => (b.def.max - b.used) - (a.def.max - a.used))[0];
        const free = tgt?.def.max! - (tgt?.used ?? 0);
        if (tgt && g.size <= free) {
          // move g
          src.used -= g.size;
          tgt.used += g.size;
          src.groups.splice(src.groups.findIndex((x) => x.order_id === g.order_id && x.size === g.size), 1);
          tgt.groups.push(g);

          const sMap = byBoat.get(src.def.vehicle_id)!;
          const tMap = byBoat.get(tgt.def.vehicle_id) ?? { seats: 0, orders: [] as any[] };
          sMap.seats -= g.size;
          const idx = sMap.orders.findIndex((x) => x.order_id === g.order_id && x.size === g.size);
          if (idx >= 0) sMap.orders.splice(idx, 1);
          tMap.seats += g.size;
          tMap.orders.push(g);
          byBoat.set(tgt.def.vehicle_id, tMap);
          moved = true;
        }
      }
      if (!moved) break;
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
  const [crewMinByJourney, setCrewMinByJourney] = useState<Map<UUID, CrewMinRow[]>>(new Map());

  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  type Candidate = { staff_id: UUID; name: string; email: string | null; priority: number; recent: number };
  const [capModal, setCapModal] = useState<{
    open: boolean;
    journeyId?: UUID;
    vehicleId?: UUID;
    fetching: boolean;
    items: Candidate[];
  }>({ open: false, fetching: false, items: [] });

  const assignTimersRef = useRef<Record<string, number>>({});

  /* ---------- Initial load ---------- */
  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase client not configured");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        // 1) future active journeys
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
          supabase.from("vehicles").select("id,name,active,minseats,maxseats,operator_id").eq("active", true),
          supabase.from("operators").select("id,name"),
        ]);
        if (rvaQ.error) throw rvaQ.error;
        if (vQ.error) throw vQ.error;
        if (oQ.error) throw oQ.error;
        setRVAs((rvaQ.data || []) as RVA[]);
        setVehicles((vQ.data || []) as Vehicle[]);
        setOperators((oQ.data || []) as Operator[]);

        // 4) orders (paid) for those journey dates
        const dateSet = new Set(js.map((j) => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // 5) persisted allocations (locks)
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

        // 6) crew (captain) min view
        const crewMap = new Map<UUID, CrewMinRow[]>();
        for (const j of js) {
          const url = `/api/ops/crew/list?journey_id=${encodeURIComponent(j.id)}`;
          const r = await fetch(url, { method: "GET", cache: "no-store" });
          if (r.ok) {
            const { data } = (await r.json()) as { ok: boolean; data: CrewMinRow[] };
            crewMap.set(j.id, data || []);
          }
        }
        setCrewMinByJourney(crewMap);
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

  /* ---------- UI shaping ---------- */
  type UiBoat = {
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    db: number; // locked seats
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
    captainName: string | null;
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
    totals: { proj: number; dbTotal: number; maxTotal: number; unassigned: number }; // proj=paid; dbTotal=locked
  };

  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length) return [];

    // orders keyed route+date (only PAID)
    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const key = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(key) ?? [];
      arr.push(o);
      ordersByKey.set(key, arr);
    }
    // rvas by route
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
        .map((o) => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter((g) => g.size > 0);
      if (!parties.length) continue;

      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter((x) => x.is_active);
      const boats: Boat[] = rvaArr
        .map((x) => {
          const v = vehicleById.get(x.vehicle_id);
          if (!v || v.active === false) return null;
          const min = Number(v.minseats ?? 0) || 0;
          const max = Number(v.maxseats ?? 0) || 0;
          return {
            vehicle_id: x.vehicle_id,
            preferred: !!x.preferred,
            min,
            max,
            operator_id: v.operator_id ?? null,
          };
        })
        .filter(Boolean) as Boat[];

      const preview = allocateDetailed(parties, boats, horizon);
      const lockedRows = locksByJourney.get(j.id) ?? [];
      const isLocked = lockedRows.length > 0;

      const perBoat: UiBoat[] = [];
      let dbTotal = 0;
      let maxTotal = 0;

      if (isLocked) {
        // ---- show locked + preview of remaining paid ----
        const lockedByBoat = new Map<UUID, { seats: number; groups: number[] }>();
        const lockedByOrder = new Map<UUID, number>();
        for (const row of lockedRows) {
          const seats = Number(row.seats || 0);
          const cur = lockedByBoat.get(row.vehicle_id) ?? { seats: 0, groups: [] as number[] };
          cur.seats += seats;
          cur.groups.push(seats);
          lockedByBoat.set(row.vehicle_id, cur);
          lockedByOrder.set(row.order_id, (lockedByOrder.get(row.order_id) ?? 0) + seats);
        }

        const remainingParties: Party[] = [];
        for (const o of oArr) {
          const paidSize = Math.max(0, Number(o.qty ?? 0));
          const alreadyLocked = lockedByOrder.get(o.id) ?? 0;
          const remaining = paidSize - alreadyLocked;
          if (remaining > 0) remainingParties.push({ order_id: o.id, size: remaining });
        }

        const previewRemaining = allocateDetailed(remainingParties, boats, horizon);

        for (const b of boats) {
          const vid = b.vehicle_id;
          const v = vehicleById.get(vid);
          const rva = rvaArr.find((x) => x.vehicle_id === vid);
          const name = v?.name ?? "Unknown";
          const opName = v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—";
          const min = v?.minseats != null ? Number(v.minseats) : null;
          const max = v?.maxseats != null ? Number(v.maxseats) : null;

          const locked = lockedByBoat.get(vid) ?? { seats: 0, groups: [] as number[] };
          const prev = previewRemaining.byBoat.get(vid);

          const mergedGroups = [...locked.groups, ...((prev?.orders ?? []).map((o) => o.size))].sort(
            (a, b) => b - a
          );

          dbTotal += locked.seats; // Locked metric stays locked only
          maxTotal += Number(max ?? 0);

          const crewRows = crewMinByJourney.get(j.id) || [];
          const cap = crewRows.find(
            (c) => c.vehicle_id === vid && (c.role_label || "").toLowerCase().includes("capt")
          );

          perBoat.push({
            vehicle_id: vid,
            vehicle_name: name,
            operator_name: opName,
            db: locked.seats,
            min,
            max,
            preferred: !!rva?.preferred,
            groups: mergedGroups,
            captainName: cap ? [cap.first_name, cap.last_name].filter(Boolean).join(" ") : null,
          });
        }
      } else {
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = preview.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;
          maxTotal += b.max;
          const crewRows = crewMinByJourney.get(j.id) || [];
          const cap = crewRows.find(
            (c) => c.vehicle_id === b.vehicle_id && (c.role_label || "").toLowerCase().includes("capt")
          );
          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find((x) => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: (entry?.orders ?? []).map((o) => o.size).sort((a, b) => b - a),
            captainName: cap ? [cap.first_name, cap.last_name].filter(Boolean).join(" ") : null,
          });
        }
        if (isTWindow(horizon)) {
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

      const proj = parties.reduce((s, p) => s + p.size, 0); // PAID
      const unassigned = Math.max(0, proj - dbTotal); // PAID minus LOCKED

      out.push({
        journey: j,
        pickup: pickupNameById.get(r.pickup_id) ?? "—",
        destination: destNameById.get(r.destination_id) ?? "—",
        depDate: dep.toLocaleDateString(),
        depTime: dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        horizon,
        isLocked,
        perBoat,
        totals: { proj, dbTotal, maxTotal, unassigned },
      });
    }

    const filtered =
      operatorFilter === "all"
        ? out
        : out
            .map((row) => ({
              ...row,
              perBoat: row.perBoat.filter(
                (b) => vehicles.find((v) => v.id === b.vehicle_id)?.operator_id === operatorFilter
              ),
            }))
            .filter((row) => row.perBoat.length > 0);

    filtered.sort(
      (a, b) => new Date(a.journey.departure_ts).getTime() - new Date(b.journey.departure_ts).getTime()
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
    crewMinByJourney,
    operatorFilter,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
  ]);

  /* ---------- Captain auto-assign on page load/refresh ---------- */
  useEffect(() => {
    rows.forEach((row) => {
      row.perBoat.forEach((b) => {
        if (b.captainName) return;
        const key = `${row.journey.id}:${b.vehicle_id}`;
        const timers = assignTimersRef.current;
        if (timers[key]) return;
        timers[key] = window.setTimeout(async () => {
          try {
            await fetch("/api/ops/auto-assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ journeyId: row.journey.id, vehicleId: b.vehicle_id }),
            });
            const r = await fetch(`/api/ops/crew/list?journey_id=${encodeURIComponent(row.journey.id)}`, {
              cache: "no-store",
            });
            if (r.ok) {
              const { data } = (await r.json()) as { ok: boolean; data: CrewMinRow[] };
              setCrewMinByJourney((prev) => {
                const copy = new Map(prev);
                copy.set(row.journey.id, data || []);
                return copy;
              });
            }
          } catch {
            /* ignore */
          } finally {
            clearTimeout(assignTimersRef.current[key]);
            delete assignTimersRef.current[key];
          }
        }, 300);
      });
    });
  }, [rows]);

  /* ---------- Lock/Unlock ---------- */
  async function lockJourney(row: UiRow) {
    if (!supabase) return;
    try {
      const parties: Party[] = (orders || [])
        .filter((o) => o.status === "paid" && o.route_id === row.journey.route_id)
        .filter((o) => o.journey_date === toDateISO(new Date(row.journey.departure_ts)))
        .map((o) => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter((g) => g.size > 0);

      const rvaArr = rvas.filter((x) => x.route_id === row.journey.route_id && x.is_active);
      const boats: Boat[] = rvaArr
        .map((x) => {
          const v = vehicles.find((vv) => vv.id === x.vehicle_id);
          if (!v || v.active === false) return null;
          return {
            vehicle_id: x.vehicle_id,
            preferred: !!x.preferred,
            min: Number(v.minseats ?? 0) || 0,
            max: Number(v.maxseats ?? 0) || 0,
            operator_id: v.operator_id ?? null,
          };
        })
        .filter(Boolean) as Boat[];

      const preview = allocateDetailed(parties, boats, row.horizon);

      await supabase.from("journey_vehicle_allocations").delete().eq("journey_id", row.journey.id);

      const toInsert: JVALockRow[] = [];
      for (const [vid, info] of preview.byBoat.entries()) {
        if (!info.seats) continue;
        for (const o of info.orders) {
          toInsert.push({ journey_id: row.journey.id, vehicle_id: vid, order_id: o.order_id, seats: o.size });
        }
      }
      if (toInsert.length) {
        const ins = await supabase.from("journey_vehicle_allocations").insert(toInsert);
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
      const del = await supabase.from("journey_vehicle_allocations").delete().eq("journey_id", journeyId);
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

  /* ---------- Captain modal actions ---------- */
  async function openCapModal(journeyId: UUID, vehicleId: UUID) {
    setCapModal({ open: true, journeyId, vehicleId, fetching: true, items: [] });
    try {
      const r = await fetch("/api/ops/captain-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId, vehicleId }), // include vehicleId
      });
      if (r.ok) {
        const data = (await r.json()) as { items?: Candidate[] };
        setCapModal((m) => ({ ...m, fetching: false, items: data.items || [] }));
      } else {
        setCapModal((m) => ({ ...m, fetching: false, items: [] }));
      }
    } catch {
      setCapModal((m) => ({ ...m, fetching: false, items: [] }));
    }
  }

  async function assignCaptain(staffId: UUID) {
    const { journeyId, vehicleId } = capModal;
    if (!journeyId || !vehicleId) return;
    try {
      const r = await fetch("/api/ops/assign/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId, vehicleId, staffId }), // include vehicleId
      });
      if (r.ok) {
        const get = await fetch(`/api/ops/crew/list?journey_id=${encodeURIComponent(journeyId)}`, {
          cache: "no-store",
        });
        if (get.ok) {
          const { data } = (await get.json()) as { ok: boolean; data: CrewMinRow[] };
          setCrewMinByJourney((prev) => {
            const copy = new Map(prev);
            copy.set(journeyId, data || []);
            return copy;
          });
        }
      } else {
        const j = await r.json().catch(() => ({}));
        setErr(j?.error ?? "Captain assignment failed");
      }
    } catch (e: any) {
      setErr(e?.message ?? "Captain assignment failed");
    } finally {
      setCapModal({ open: false, fetching: false, items: [] });
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operator dashboard — Live Journeys</h1>
          <p className="text-neutral-600 text-sm">
            Future journeys only · <strong>Paid</strong> = confirmed bookings · <strong>Locked</strong> = seats persisted to boats.
            At <strong>T-72/T-24</strong> you may keep accepting bookings; press <strong>Lock</strong> to persist an updated split.
          </p>
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
                {o.name ?? "—"}
              </option>
            ))}
          </select>
        </div>
      </header>

      {err && <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow">No journeys with paid bookings yet.</div>
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
                  {row.horizon === "T24" ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs">T-24 (Confirmed)</span>
                  ) : row.horizon === "T72" ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">T-72 (Confirmed)</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">
                      &gt;72h (Prep)
                    </span>
                  )}

                  <span className="text-xs text-neutral-700">
                    Paid: <strong>{row.totals.proj}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Locked: <strong>{row.totals.dbTotal}</strong>
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
                      <th className="text-right p-3">Locked</th>
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
                          {b.captainName ? (
                            <div className="flex items-center gap-2">
                              <span>{b.captainName}</span>
                              <button
                                className="text-xs underline text-blue-700"
                                onClick={() => openCapModal(row.journey.id, b.vehicle_id)}
                              >
                                change
                              </button>
                            </div>
                          ) : (
                            <button
                              className="text-xs underline text-blue-700"
                              onClick={() => openCapModal(row.journey.id, b.vehicle_id)}
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

      {/* Captain modal */}
      {capModal.open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[520px] max-w-[95vw]">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="font-medium">Assign captain</div>
              <button
                className="text-sm text-neutral-600"
                onClick={() => setCapModal({ open: false, fetching: false, items: [] })}
              >
                Close
              </button>
            </div>
            <div className="p-3 space-y-2 max-h-[60vh] overflow-auto">
              {capModal.fetching ? (
                <div className="text-sm text-neutral-600">Loading…</div>
              ) : capModal.items.length === 0 ? (
                <div className="text-sm text-neutral-600">No eligible captains found.</div>
              ) : (
                capModal.items.map((c) => (
                  <div
                    key={c.staff_id}
                    className="flex items-center justify-between border rounded-lg px-3 py-2 hover:bg-neutral-50"
                  >
                    <div className="text-sm">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-neutral-600 text-xs">
                        Priority {c.priority} · recent confirms {c.recent}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    </div>
                    <button
                      className="text-xs px-3 py-1 rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50"
                      onClick={() => assignCaptain(c.staff_id)}
                    >
                      Assign
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
