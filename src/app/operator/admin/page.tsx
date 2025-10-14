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

/* ---------- Supabase ---------- */
const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Helpers ---------- */
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
function todayTomorrowLabel(tsISO: string): "today" | "tomorrow" | null {
  const dep = new Date(tsISO);
  const now = new Date();
  if (dep.toDateString() === now.toDateString()) return "today";
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  if (dep.toDateString() === tmr.toDateString()) return "tomorrow";
  return null;
}

/* ---------- Allocation  (exactly mirrors the server) ---------- */
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
  // preferred first, then smaller cap, then id
  if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
  if (a.cap !== b.cap) return a.cap - b.cap;
  return a.vehicle_id.localeCompare(b.vehicle_id);
}

/** >72h: fill one boat per operator to MIN, then round-robin. */
function allocateRoundRobinByOperator(parties: Party[], boats: Boat[]): AllocMap {
  const byOp = new Map<string, Boat[]>();
  for (const b of boats.slice().sort(sortBoats)) {
    const key = b.operator_id ?? "none";
    byOp.set(key, [...(byOp.get(key) ?? []), b]);
  }
  const opKeys = [...byOp.keys()].sort();
  const byBoat: AllocMap = new Map();
  const used = new Map<UUID, number>();

  function bump(id: UUID, order_id: UUID, size: number) {
    used.set(id, (used.get(id) ?? 0) + size);
    const cur = byBoat.get(id) ?? { seats: 0, groups: [] as { order_id: UUID; size: number }[] };
    cur.seats += size;
    cur.groups.push({ order_id, size });
    byBoat.set(id, cur);
  }

  const remaining = parties.slice().sort((a, b) => b.size - a.size);
  const iter = () => {
    for (const op of opKeys) {
      const stack = byOp.get(op)!;
      let target: Boat | null = null;
      for (const b of stack) {
        const u = used.get(b.vehicle_id) ?? 0;
        if (u < b.cap) {
          target = b;
          if (u < b.min) break; // prioritise reaching min
        }
      }
      if (!target) continue;

      const idx = remaining.findIndex((g) => g.size <= (target!.cap - (used.get(target!.vehicle_id) ?? 0)));
      if (idx === -1) continue;
      const [g] = remaining.splice(idx, 1);
      bump(target.vehicle_id, g.order_id, g.size);
      return true;
    }
    return false;
  };

  let progress = true;
  while (remaining.length && progress) progress = iter();

  return byBoat;
}

/** T-72 gates: keep in-play vehicles, drop empties, require MIN (allow single-boat MIN-1) */
function enforceT72Gates(byBoat: AllocMap, boats: Boat[], inPlay: Set<UUID>): AllocMap {
  const gated = new Map<UUID, { seats: number; groups: { order_id: UUID; size: number }[] }>();
  for (const [vid, rec] of byBoat.entries()) if (inPlay.has(vid)) gated.set(vid, rec);

  for (const [vid, rec] of [...gated.entries()]) if ((rec?.seats ?? 0) <= 0) gated.delete(vid);

  const survivors = [...gated.entries()];
  if (!survivors.length) return gated;

  if (survivors.length === 1) {
    const [vid, rec] = survivors[0];
    const def = boats.find((b) => b.vehicle_id === vid);
    if (!def) return gated;
    if (rec.seats >= def.min - 1) return gated;
    gated.delete(vid);
    return gated;
  }

  for (const [vid, rec] of [...gated.entries()]) {
    const def = boats.find((b) => b.vehicle_id === vid);
    if (!def) continue;
    if (rec.seats < def.min) gated.delete(vid);
  }
  return gated;
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
  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  const realtimeSubRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);

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

        // 4) paid orders (window)
        const dateSet = new Set(js.map(j => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // 5) persisted locks
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
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    operator_id: UUID | null;
    customers: number;
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
  };

  type UiRow = {
    journey: Journey;
    pickup: string;
    destination: string;
    depDate: string;
    depTime: string;
    horizon: Horizon;
    contextDay?: "today" | "tomorrow" | null;
    isLocked: boolean;
    perBoat: UiBoat[];
    totals: {
      proj: number;
      dbTotal: number;
      maxTotal: number;
      unassigned: number;
    };
    preview?: AllocMap;
    parties?: Party[];
    boats?: Boat[];
  };

  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length) return [];

    // Orders grouped by (route_id, date)
    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const k = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(k) ?? [];
      arr.push(o);
      ordersByKey.set(k, arr);
    }

    // RVAs by route
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
        .map(o => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter(g => g.size > 0);

      if (!parties.length) continue;

      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter(x => x.is_active);
      const boats: Boat[] = rvaArr
        .map(x => {
          const v = vehicleById.get(x.vehicle_id);
          if (!v || v.active === false) return null;
          const cap = Number(v?.maxseats ?? 0) || 0;
          const min = Number(v?.minseats ?? 0) || 0;
          return {
            vehicle_id: x.vehicle_id,
            preferred: !!x.preferred,
            cap,
            min,
            operator_id: v.operator_id ?? null,
          };
        })
        .filter(Boolean) as Boat[];

      // Build preview using the exact server logic
      let preview: AllocMap = allocateRoundRobinByOperator(parties, boats);

      // If journey already has persisted rows, derive from DB; otherwise show preview
      const locked = locksByJourney.get(j.id) ?? [];
      const isLocked = locked.length > 0;

      // In-play vehicles come from current allocations (for T-72 gating)
      const inPlay = new Set<UUID>((locked || []).map(r => r.vehicle_id));
      if (horizon === "T72") preview = enforceT72Gates(preview, boats, inPlay);

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
          dbTotal += data.seats;
          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            customers: data.seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === vehId)?.preferred,
            groups: data.groups.sort((a, b) => b - a),
          });
        }
        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);
        if (isT72orT24(horizon)) {
          for (let i = perBoat.length - 1; i >= 0; i--) if (perBoat[i].customers <= 0) perBoat.splice(i, 1);
        }
      } else {
        // from preview
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = preview.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;
          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            customers: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === b.vehicle_id)?.preferred,
            groups: (entry?.groups ?? []).map(o => o.size).sort((a, b) => b - a),
          });
        }
        const un = [...preview.values()].flatMap(v => v.groups).reduce((s, g) => s, 0); // placeholder
        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);
        if (isT72orT24(horizon)) {
          for (let i = perBoat.length - 1; i >= 0; i--) if (perBoat[i].customers <= 0) perBoat.splice(i, 1);
        }
      }

      const maxTotal = boats.reduce((s, b) => s + b.cap, 0);

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
        preview,
        parties,
        boats,
      });
    }

    const filtered =
      operatorFilter === "all"
        ? out
        : out
            .map(row => ({
              ...row,
              perBoat: row.perBoat.filter(b => b.operator_id === operatorFilter),
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
    operatorFilter,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
  ]);

  /* ---------- Captain auto-assign triggers ---------- */

  async function triggerCaptainAssign(journey_id: UUID, vehicle_id: UUID) {
    try {
      const res = await fetch("/api/ops/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id, vehicle_id }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("auto-assign failed", res.status, txt);
      }
    } catch (e) {
      console.warn("auto-assign error", e);
    }
  }

  // fire once after initial render
  useEffect(() => {
    if (!rows.length) return;
    for (const r of rows) {
      for (const b of r.perBoat) {
        if (b.customers > 0) triggerCaptainAssign(r.journey.id, b.vehicle_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // realtime: new or updated paid orders -> reload + auto assign
  useEffect(() => {
    if (!supabase) return;
    if (realtimeSubRef.current) return;

    const ch = supabase
      .channel("ops-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        async (payload: any) => {
          const after = payload.new;
          const before = payload.old;
          const nowPaid =
            (after?.status === "paid" && before?.status !== "paid") ||
            (payload.eventType === "INSERT" && after?.status === "paid");
          if (nowPaid) {
            // simple approach: refresh page data; captain assign will run after rows recompute
            window.location.reload();
          }
        }
      )
      .subscribe();
    realtimeSubRef.current = ch;

    return () => {
      if (realtimeSubRef.current) {
        supabase.removeChannel(realtimeSubRef.current);
        realtimeSubRef.current = null;
      }
    };
  }, []);

  /* ---------- Lock / Unlock ---------- */
  async function lockJourney(row: UiRow) {
    try {
      // ask server to finalize using the same policy
      const res = await fetch("/api/ops/finalize-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: row.journey.id }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setErr(`Finalize failed: ${res.status} ${txt}`);
        return;
      }
      // refresh locks for this journey
      if (supabase) {
        const { data, error } = await supabase
          .from("journey_vehicle_allocations")
          .select("journey_id,vehicle_id,order_id,seats")
          .eq("journey_id", row.journey.id);
        if (error) throw error;
        setLocksByJourney(prev => {
          const copy = new Map(prev);
          copy.set(row.journey.id, (data || []) as any);
          return copy;
        });
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function unlockJourney(journeyId: UUID) {
    try {
      const res = await fetch("/api/ops/finalize-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // clearing by sending no demand -> server deletes, but we’ll just hard delete here for safety in UI
        body: JSON.stringify({}), 
      });
      // ignore response; do local delete
      if (supabase) {
        const del = await supabase
          .from("journey_vehicle_allocations")
          .delete()
          .eq("journey_id", journeyId);
        if (del.error) throw del.error;
        setLocksByJourney(prev => {
          const copy = new Map(prev);
          copy.delete(journeyId);
          return copy;
        });
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  /* ---------- Render ---------- */
  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operator dashboard — Live Journeys</h1>
          <p className="text-neutral-600 text-sm">
            Future journeys only · Customers from paid orders · Preview matches server policy —
            use <strong>Lock</strong> to persist.
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

                  {/* Lock/Unlock */}
                  {(row.horizon === "T24" || row.horizon === "T72") && (
                    row.isLocked ? (
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
                    )
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
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.perBoat.map(b => (
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
                          <div className="text-[11px] text-neutral-500 mt-1">
                            Captain:{" "}
                            <button
                              className="underline"
                              onClick={() => triggerCaptainAssign(row.journey.id, b.vehicle_id)}
                              title="Auto-assign / change captain for this boat"
                            >
                              Assign
                            </button>
                          </div>
                        </td>
                        <td className="p-3">{b.operator_name}</td>
                        <td className="p-3 text-right">{b.customers}</td>
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
    </div>
  );
}
