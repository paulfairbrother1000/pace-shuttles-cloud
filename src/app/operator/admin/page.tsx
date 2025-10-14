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
  vehicle_id: UUID | null;
  operator_id: UUID | null;
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

type Staff = { id: UUID; first_name?: string | null; last_name?: string | null };

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

/* ---------- Server-like allocation helpers (match API) ---------- */
type Party = { order_id: UUID; size: number };
type Boat = {
  vehicle_id: UUID;
  preferred: boolean;
  min: number;
  max: number;
  operator_id?: UUID | null;
};

type ByBoat = Map<
  UUID,
  { seats: number; orders: { order_id: UUID; size: number }[] }
>;

function sortBoats(a: Boat, b: Boat) {
  if (!!a.preferred !== !!b.preferred) return a.preferred ? -1 : 1;
  if (a.max !== b.max) return a.max - b.max;
  return a.vehicle_id.localeCompare(b.vehicle_id);
}

function allocateRoundRobinByOperator(
  parties: Party[],
  boats: Boat[]
): ByBoat {
  const byOp = new Map<string, Boat[]>();
  for (const b of boats.slice().sort(sortBoats)) {
    const key = b.operator_id ?? "none";
    byOp.set(key, [...(byOp.get(key) ?? []), b]);
  }
  const opKeys = [...byOp.keys()].sort();
  const byBoat: ByBoat = new Map();
  const used = new Map<UUID, number>();

  function bump(id: UUID, order_id: UUID, size: number) {
    used.set(id, (used.get(id) ?? 0) + size);
    const cur =
      byBoat.get(id) ?? ({ seats: 0, orders: [] } as {
        seats: number;
        orders: { order_id: UUID; size: number }[];
      });
    cur.seats += size;
    cur.orders.push({ order_id, size });
    byBoat.set(id, cur);
  }

  const remaining = parties.slice().sort((a, b) => b.size - a.size);
  const iter = () => {
    for (const op of opKeys) {
      const stack = byOp.get(op)!;
      let target: Boat | null = null;
      for (const b of stack) {
        const u = used.get(b.vehicle_id) ?? 0;
        if (u < b.max) {
          target = b;
          if (u < b.min) break; // top to MIN first
        }
      }
      if (!target) continue;

      const idx = remaining.findIndex(
        (g) => g.size <= (target!.max - (used.get(target!.vehicle_id) ?? 0))
      );
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

/** T-72 gating: keep only in-play boats, drop empties, require MIN except single-boat MIN-1 */
function enforceT72Gates(
  byBoat: ByBoat,
  boats: Boat[],
  inPlay: Set<UUID>
): ByBoat {
  const gated: ByBoat = new Map();
  for (const [vid, rec] of byBoat.entries()) {
    if (inPlay.has(vid)) gated.set(vid, rec);
  }
  for (const [vid, rec] of [...gated.entries()]) {
    if ((rec?.seats ?? 0) <= 0) gated.delete(vid);
  }

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

  // Captains (journey_id+vehicle_id → staff_id)
  const [captains, setCaptains] = useState<Map<string, UUID>>(new Map());
  const [staffById, setStaffById] = useState<Map<UUID, Staff>>(new Map());

  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  // modal state for reassigning captain
  const [capModalOpen, setCapModalOpen] = useState(false);
  const [capModalJourney, setCapModalJourney] = useState<UUID | null>(null);
  const [capModalVehicle, setCapModalVehicle] = useState<UUID | null>(null);
  const [capCandidates, setCapCandidates] = useState<Staff[]>([]);
  const [capBusy, setCapBusy] = useState(false);

  // simpler typing to avoid TS error during build
  const realtimeSubRef = useRef<any>(null);

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
        // 1) future, active journeys (+vehicle/operator for captain logic)
        const { data: jData, error: jErr } = await supabase
          .from("journeys")
          .select("id,route_id,departure_ts,is_active,vehicle_id,operator_id")
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

        // 4) paid orders window
        const dateSet = new Set(js.map((j) => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // 5) persisted allocations
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

        // 6) Load current captain assignments
        await refreshCaptainsFor(journeyIds);

        // 7) Auto-assign captains on load for journeys at/after T-72 with vehicle but no captain
        await autoAssignCaptainsIfMissing(js);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();

    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Realtime: new bookings -> finalize + auto-assign captain ---------- */
  useEffect(() => {
    if (!supabase) return;

    const ch = supabase
      .channel("ops-admin-bookings")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bookings" },
        async (payload: any) => {
          const jid = payload?.new?.journey_id as UUID | null;
          if (!jid) return;
          try {
            await fetch("/api/ops/finalize-allocations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ journey_id: jid }),
            });

            await fetch("/api/ops/auto-assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ journey_id: jid, role_code: "CAPTAIN" }),
            });

            await refreshCaptainsFor([jid]);
            await refreshLocksFor([jid]);
          } catch (e) {
            console.error("booking realtime handler failed:", e);
          }
        }
      )
      .subscribe();

    realtimeSubRef.current = ch;
    return () => {
      if (realtimeSubRef.current && supabase) {
        supabase.removeChannel(realtimeSubRef.current);
        realtimeSubRef.current = null;
      }
    };
  }, []);

  async function refreshLocksFor(journeyIds: UUID[]) {
    if (!supabase || !journeyIds.length) return;
    const { data, error } = await supabase
      .from("journey_vehicle_allocations")
      .select("journey_id,vehicle_id,order_id,seats")
      .in("journey_id", journeyIds);
    if (error) return;
    setLocksByJourney((prev) => {
      const copy = new Map(prev);
      const byJ = new Map<UUID, JVALockRow[]>();
      (data || []).forEach((row: any) => {
        const arr = byJ.get(row.journey_id) ?? [];
        arr.push({
          journey_id: row.journey_id,
          vehicle_id: row.vehicle_id,
          order_id: row.order_id,
          seats: Number(row.seats || 0),
        });
        byJ.set(row.journey_id, arr);
      });
      for (const jid of journeyIds) {
        copy.set(jid, byJ.get(jid) ?? []);
      }
      return copy;
    });
  }

  async function refreshCaptainsFor(journeyIds: UUID[]) {
    if (!supabase || !journeyIds.length) return;

    const { data: capRows, error } = await supabase
      .from("journey_crew_assignments")
      .select("id,journey_id,vehicle_id,staff_id,role_code,status,assigned_at")
      .in("journey_id", journeyIds)
      .eq("role_code", "CAPTAIN")
      .in("status", ["assigned", "confirmed"]);
    if (error) return;

    const map = new Map<string, UUID>();
    const staffIds = new Set<UUID>();
    (capRows || []).forEach((r: any) => {
      if (!r.vehicle_id) return;
      const k = `${r.journey_id}_${r.vehicle_id}`;
      if (!map.get(k)) map.set(k, r.staff_id as UUID);
      staffIds.add(r.staff_id as UUID);
    });

    if (staffIds.size) {
      const { data: staffData } = await supabase
        .from("operator_staff")
        .select("id,first_name,last_name")
        .in("id", Array.from(staffIds));
      const sMap = new Map<UUID, Staff>();
      (staffData || []).forEach((s: any) =>
        sMap.set(s.id as UUID, { id: s.id, first_name: s.first_name, last_name: s.last_name })
      );
      setStaffById((prev) => new Map([...prev, ...sMap]));
    }

    setCaptains((prev) => {
      const copy = new Map(prev);
      for (const [k, v] of map.entries()) copy.set(k, v);
      return copy;
    });
  }

  async function autoAssignCaptainsIfMissing(js: Journey[]) {
    const targets: Journey[] = [];
    for (const j of js) {
      const h = horizonFor(j.departure_ts);
      if ((h === "T72" || h === "T24") && j.vehicle_id) {
        const key = `${j.id}_${j.vehicle_id}`;
        if (!captains.get(key)) targets.push(j);
      }
    }
    if (!targets.length) return;

    for (const j of targets) {
      try {
        await fetch("/api/ops/auto-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journey_id: j.id, role_code: "CAPTAIN" }),
        });
      } catch {}
    }
    await refreshCaptainsFor(targets.map((t) => t.id));
  }

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

  /* ---------- UI Rows ---------- */
  type UiBoat = {
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    db: number;
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
    captainName?: string;
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
    totals: { proj: number; dbTotal: number; maxTotal: number; unassigned: number };
    previewAlloc?: { byBoat: ByBoat };
    lockedAlloc?: JVALockRow[];
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
      const ctxDay = todayTomorrowLabel(j.departure_ts);

      const oArr = ordersByKey.get(`${j.route_id}_${dateISO}`) ?? [];
      const parties: Party[] = oArr
        .map((o) => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter((g) => g.size > 0);

      if (!parties.length) continue; // skip journeys with no customers

      // Candidate boats from RVAs
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
          };
        })
        .filter(Boolean) as Boat[];

      // Build preview allocation using the same policy as the server
      let byBoat: ByBoat | undefined;
      if (horizon === ">72h" || horizon === "T72") {
        const rr = allocateRoundRobinByOperator(parties, boats);
        if (horizon === "T72") {
          // in-play vehicle ids from persisted rows:
          const inPlay = new Set<UUID>((locksByJourney.get(j.id) ?? []).map((x) => x.vehicle_id));
          byBoat = enforceT72Gates(rr, boats, inPlay);
        } else {
          byBoat = rr;
        }
      }

      const maxTotal = boats.reduce((s, b) => s + b.max, 0);

      // If locked, build from persisted rows
      const locked = locksByJourney.get(j.id) ?? [];
      const isLocked = locked.length > 0;

      const perBoat: UiBoat[] = [];
      let dbTotal = 0;
      let unassigned = 0;

      const addCaptainName = (jid: UUID, vid: UUID) => {
        const key = `${jid}_${vid}`;
        const sid = captains.get(key);
        if (!sid) return undefined;
        const st = staffById.get(sid);
        const name = [st?.first_name, st?.last_name].filter(Boolean).join(" ").trim();
        return name || "—";
      };

      if (isLocked && horizon !== ">72h") {
        // Use persisted rows in T72/T24/past
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
          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—",
            db: data.seats,
            min,
            max,
            preferred: !!rvaArr.find((x) => x.vehicle_id === vehId)?.preferred,
            groups: data.groups.sort((a, b) => b - a),
            captainName: addCaptainName(j.id, vehId),
          });
        }
        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);
        // hide zero-customer boats in T72/T24
        for (let i = perBoat.length - 1; i >= 0; i--) {
          if (perBoat[i].db <= 0) perBoat.splice(i, 1);
        }
      } else {
        // Preview from byBoat
        for (const b of boats) {
          const v = vehicleById.get(b.vehicle_id);
          const entry = byBoat?.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          dbTotal += seats;
          const groups = (entry?.orders ?? []).map((o) => o.size).sort((a, b) => b - a);
          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? operatorNameById.get(v.operator_id) ?? "—" : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find((x) => x.vehicle_id === b.vehicle_id)?.preferred,
            groups,
            captainName: addCaptainName(j.id, b.vehicle_id),
          });
        }
        const proj = parties.reduce((s, p) => s + p.size, 0);
        unassigned = Math.max(0, proj - dbTotal);
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
        previewAlloc: byBoat ? { byBoat } : undefined,
        lockedAlloc: locked,
        parties,
        boats,
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
                  vehicles.find((v) => v.id === b.vehicle_id)?.operator_id === operatorFilter
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
    captains,
    staffById,
  ]);

  /* ---------- Actions: Lock / Unlock ---------- */

  async function lockJourney(row: any) {
    try {
      const res = await fetch("/api/ops/finalize-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: row.journey.id }),
      });
      if (!res.ok) throw new Error("Finalize failed");

      await fetch("/api/ops/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: row.journey.id, role_code: "CAPTAIN" }),
      });

      await refreshLocksFor([row.journey.id]);
      await refreshCaptainsFor([row.journey.id]);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function unlockJourney(journeyId: UUID) {
    try {
      const del = await supabase!
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

  /* ---------- Captain: open modal, fetch candidates, assign ---------- */
  async function openCaptainModal(journeyId: UUID, vehicleId: UUID) {
    setCapModalJourney(journeyId);
    setCapModalVehicle(vehicleId);
    setCapCandidates([]);
    setCapBusy(false);
    setCapModalOpen(true);
    try {
      const r = await fetch(
        `/api/ops/captain-candidates?journey_id=${encodeURIComponent(
          journeyId
        )}&vehicle_id=${encodeURIComponent(vehicleId)}`
      );
      const js = (await r.json()) as { ok: boolean; candidates?: Array<{ id: UUID; first_name?: string; last_name?: string }> };
      const items: Staff[] =
        js?.candidates?.map((c) => ({
          id: c.id,
          first_name: c.first_name ?? "",
          last_name: c.last_name ?? "",
        })) ?? [];
      setCapCandidates(items);
    } catch {
      // best-effort
    }
  }
  function closeCaptainModal() {
    setCapModalOpen(false);
    setCapModalJourney(null);
    setCapModalVehicle(null);
    setCapCandidates([]);
    setCapBusy(false);
  }

  async function assignCaptain(staffId: UUID) {
    if (!capModalJourney || !capModalVehicle) return;
    setCapBusy(true);
    try {
      const res = await fetch("/api/ops/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: capModalJourney,
          vehicle_id: capModalVehicle,
          staff_id: staffId,
          role_code: "CAPTAIN",
        }),
      });
      if (!res.ok) throw new Error("Captain assignment failed");
      await refreshCaptainsFor([capModalJourney]);
      closeCaptainModal();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
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
                        className="text-xs px-3 py-1 rounded-lg border border-blue-600 text-blue-600 hover:bg-blue-50"
                        onClick={() => lockJourney(row)}
                        title="Persist the current allocation via server"
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
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map}
                    {row.perBoat.map((b) => (
                      <tr key={`${row.journey.id}_${b.vehicle_id}`} className="border-t align-top">
                        <td className="p-3">
                          <div className="flex items-start gap-2">
                            <div className="font-medium">{b.vehicle_name}</div>
                            {b.preferred && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                preferred
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-neutral-600 mt-1">
                            Captain:&nbsp;
                            {b.captainName ? (
                              <button
                                className="underline hover:opacity-80"
                                onClick={() => openCaptainModal(row.journey.id, b.vehicle_id)}
                                title="Change captain"
                              >
                                {b.captainName}
                              </button>
                            ) : (
                              <button
                                className="underline hover:opacity-80"
                                onClick={() => openCaptainModal(row.journey.id, b.vehicle_id)}
                                title="Assign captain"
                              >
                                Assign
                              </button>
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

      {/* Captain selection modal */}
      {capModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow p-4 space-y-3">
            <div className="text-base font-semibold">Select a captain</div>
            {capCandidates.length === 0 ? (
              <div className="text-sm text-neutral-600">Loading candidates…</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {capCandidates.map((c) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
                  return (
                    <button
                      key={c.id}
                      onClick={() => assignCaptain(c.id)}
                      disabled={capBusy}
                      className="w-full text-left rounded-md border px-3 py-2 hover:bg-neutral-50"
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={closeCaptainModal}
                className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
                disabled={capBusy}
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
