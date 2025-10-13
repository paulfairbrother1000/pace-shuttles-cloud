// src/app/operator/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

/* ---------------- Supabase (browser) ---------------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------------- ps_user resolution ---------------- */
type PsUser = {
  id?: string;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  site_admin?: boolean | null;
};

function readPsUserLocal(): PsUser | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}

async function resolveOperatorFromAuthOrProfile(): Promise<PsUser | null> {
  if (!sb) return null;

  // First try Supabase auth metadata
  try {
    const { data: ures } = await sb.auth.getUser();
    const user = ures?.user;
    if (user) {
      const meta = (user.user_metadata || {}) as Record<string, any>;
      const appm = (user.app_metadata || {}) as Record<string, any>;
      const claim =
        meta.operator_id ??
        appm.operator_id ??
        meta?.ps_user?.operator_id ??
        appm?.ps_user?.operator_id;

      const opAdmin =
        Boolean(
          meta.operator_admin ??
            appm.operator_admin ??
            meta?.ps_user?.operator_admin ??
            appm?.ps_user?.operator_admin
        ) || false;

      const siteAdmin =
        Boolean(
          meta.site_admin ??
            appm.site_admin ??
            meta?.ps_user?.site_admin ??
            appm?.ps_user?.site_admin
        ) || false;

      if (claim) {
        return {
          id: user.id,
          operator_admin: opAdmin || siteAdmin,
          operator_id: String(claim),
          operator_name:
            (meta.operator_name ??
              appm.operator_name ??
              meta?.ps_user?.operator_name ??
              appm?.ps_user?.operator_name) || null,
          site_admin: siteAdmin,
        };
      }
      return {
        id: user.id,
        operator_admin: opAdmin || siteAdmin,
        operator_id: null,
        operator_name: null,
        site_admin: siteAdmin,
      };
    }
  } catch {}

  // Then try profiles fallback
  try {
    const { data: ures } = await sb.auth.getUser();
    const uid = ures?.user?.id;
    if (!uid) return null;

    const { data, error } = await sb
      .from("profiles")
      .select("id, operator_admin, operator_id, site_admin")
      .eq("id", uid)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id as string,
      operator_admin: Boolean((data as any).operator_admin || (data as any).site_admin),
      operator_id: (data as any).operator_id ?? null,
      operator_name: null,
      site_admin: Boolean((data as any).site_admin),
    };
  } catch {
    return null;
  }
}

/* ---------------- DB row types ---------------- */
type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
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
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID;
  status_simple: "allocated" | "confirmed" | "complete" | "cancelled";
  first_name: string | null;
  last_name: string | null;
};

/* ---------------- Helpers ---------------- */
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
  if (h <= 24) return "T24";
  if (h <= 72) return "T72";
  return ">72h";
}
function isLockedWindow(h: "T24" | "T72" | ">72h" | "past") {
  return h === "T24" || h === "past";
}
function staffName(s?: { first_name: string | null; last_name: string | null }) {
  return `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim() || "Unnamed";
}

/* ---------------- Allocation preview (for grouping pills only) ---------------- */
type Party = { order_id: UUID; size: number };
type Boat = { vehicle_id: UUID; cap: number; preferred: boolean };
type DetailedAlloc = {
  byBoat: Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>;
  unassigned: { order_id: UUID; size: number }[];
  total: number;
};
function allocateDetailed(parties: Party[], boats: Boat[]): DetailedAlloc {
  const sorted = [...parties].filter(p => p.size > 0).sort((a, b) => b.size - a.size);
  const state = boats.map(b => ({
    vehicle_id: b.vehicle_id,
    cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
    used: 0,
    preferred: !!b.preferred,
  }));
  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  const unassigned: { order_id: UUID; size: number }[] = [];

  for (const g of sorted) {
    const candidates = state
      .map(s => ({ id: s.vehicle_id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter(c => c.free >= g.size)
      .sort((a, b) => {
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        if (a.free !== b.free) return a.free - b.free;
        return a.id.localeCompare(b.id);
      });

    if (!candidates.length) {
      unassigned.push({ order_id: g.order_id, size: g.size });
      continue;
    }
    const chosen = candidates[0];
    chosen.ref.used += g.size;
    const cur = byBoat.get(chosen.id) ?? { seats: 0, orders: [] };
    cur.seats += g.size;
    cur.orders.push({ order_id: g.order_id, size: g.size });
    byBoat.set(chosen.id, cur);
  }

  const total = sorted.reduce((s, p) => s + p.size, 0);
  return { byBoat, unassigned, total };
}

/* ---------------- Page ---------------- */
export default function OperatorAdminJourneysPage() {
  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [psLoaded, setPsLoaded] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      const fromLocal = readPsUserLocal();
      if (fromLocal?.operator_admin && (fromLocal.operator_id || fromLocal.site_admin)) {
        if (!off) {
          setPsUser(fromLocal);
          setPsLoaded(true);
        }
        return;
      }
      const fromAuth = await resolveOperatorFromAuthOrProfile();
      if (off) return;

      if (fromAuth?.operator_admin) {
        try {
          localStorage.setItem("ps_user", JSON.stringify(fromAuth));
        } catch {}
        setPsUser(fromAuth);
      } else {
        setPsUser(fromLocal || fromAuth || null);
      }
      setPsLoaded(true);
    })();
    return () => {
      off = true;
    };
  }, []);

  const isSiteAdmin = !!psUser?.site_admin;
  const opIdFromUser = psUser?.operator_admin ? psUser?.operator_id ?? null : null;

  // Site admin can choose "ALL" or a specific operator; operator admins are fixed to their op.
  const [operatorFilter, setOperatorFilter] = useState<string>("ALL");
  useEffect(() => {
    if (!isSiteAdmin && opIdFromUser) setOperatorFilter(opIdFromUser);
    if (isSiteAdmin && !opIdFromUser) setOperatorFilter("ALL");
    if (isSiteAdmin && opIdFromUser) setOperatorFilter("ALL"); // default to ALL when site admin logs in
  }, [isSiteAdmin, opIdFromUser]);

  const canSeeAll = isSiteAdmin && operatorFilter === "ALL";
  const effectiveOperatorId: string | null = canSeeAll ? null : operatorFilter;

  /* Data */
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

  // crew/assignments
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [assigns, setAssigns] = useState<AssignView[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null); // key journeyId_vehicleId
  const [selectedStaff, setSelectedStaff] = useState<Record<string, UUID>>({}); // key -> staff_id
  const [editingAssignee, setEditingAssignee] = useState<Record<string, boolean>>({}); // toggles dropdown

  // Kick the server finalizer first, so the page always reflects persisted allocation.
  const [autoErr, setAutoErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!psLoaded) return;
      try {
        const scope = isSiteAdmin
          ? canSeeAll
            ? { all: true }
            : { operator_id: effectiveOperatorId }
          : { operator_id: opIdFromUser };

        await fetch("/api/ops/finalize-allocations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scope),
        });

        // Also run auto-assign for missing leads in scope (pre T-24 only).
        await fetch("/api/ops/auto-assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(scope),
        });

        if (!cancelled) setAutoErr(null);
      } catch (e: any) {
        if (!cancelled) setAutoErr(e?.message ?? "Auto-finalize/assign failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [psLoaded, isSiteAdmin, canSeeAll, effectiveOperatorId, opIdFromUser]);

  // Load data (after the finalizer tries to persist the right allocation)
  useEffect(() => {
    if (!psLoaded) return;
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);

      try {
        const { data: jData, error: jErr } = await sb
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

        const [rQ, puQ, deQ] = await Promise.all([
          sb.from("routes").select("id,pickup_id,destination_id").in("id", routeIds),
          sb.from("pickup_points").select("id,name"),
          sb.from("destinations").select("id,name"),
        ]);
        if (rQ.error) throw rQ.error;
        if (puQ.error) throw puQ.error;
        if (deQ.error) throw deQ.error;

        setRoutes((rQ.data || []) as Route[]);
        setPickups((puQ.data || []) as Pickup[]);
        setDestinations((deQ.data || []) as Destination[]);

        const [rvaQ, vQ, oQ] = await Promise.all([
          sb
            .from("route_vehicle_assignments")
            .select("route_id,vehicle_id,is_active,preferred")
            .in("route_id", routeIds)
            .eq("is_active", true),
          sb
            .from("vehicles")
            .select("id,name,active,minseats,maxseats,operator_id")
            .eq("active", true),
          sb.from("operators").select("id,name"),
        ]);
        if (rvaQ.error) throw rvaQ.error;
        if (vQ.error) throw vQ.error;
        if (oQ.error) throw oQ.error;

        setRVAs((rvaQ.data || []) as RVA[]);
        setVehicles((vQ.data || []) as Vehicle[]);
        setOperators((oQ.data || []) as Operator[]);

        const dateSet = new Set(js.map(j => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await sb
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        if (journeyIds.length) {
          const { data: lockData, error: lockErr } = await sb
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

        // crew/staff scope (and eligibility filter)
        const staffScope = isSiteAdmin && canSeeAll ? {} : { operator_id: effectiveOperatorId };
        const staffQuery = sb
          .from("operator_staff")
          .select("id,user_id,operator_id,first_name,last_name,active,role_id,jobrole")
          .eq("active", true);

        if ((staffScope as any).operator_id) staffQuery.eq("operator_id", (staffScope as any).operator_id);

        const { data: sData } = await staffQuery;
        const srows = ((sData || []) as StaffRow[]).filter(s =>
          ["captain", "pilot", "driver"].includes((s.jobrole || "").toLowerCase())
        );
        srows.sort((a, b) => {
          const an = `${a.last_name || ""} ${a.first_name || ""}`.toLowerCase().trim();
          const bn = `${b.last_name || ""} ${b.first_name || ""}`.toLowerCase().trim();
          return an.localeCompare(bn);
        });
        setStaff(srows);

        // current assignments (view)
        if (journeyIds.length) {
          const { data: aData } = await sb
            .from("v_journey_staff_min")
            .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
            .in("journey_id", journeyIds);
          setAssigns(((aData || []) as AssignView[]) ?? []);
        } else {
          setAssigns([]);
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
  }, [psLoaded, isSiteAdmin, canSeeAll, effectiveOperatorId]);

  /* ---------------- Lookups ---------------- */
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
  const assignByKey = useMemo(() => {
    const m = new Map<string, AssignView>();
    assigns.forEach(a => m.set(`${a.journey_id}_${a.vehicle_id}`, a));
    return m;
  }, [assigns]);

  /* ---------------- Build rows ---------------- */
  type UiBoat = {
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    db: number;
    min: number | null;
    max: number | null;
    preferred?: boolean;
    groups: number[];
    canRemove: boolean;
    cannotReason?: string;
    assignee?: { staff_id: UUID; name: string; status: AssignView["status_simple"] };
  };
  type UiRow = {
    journey: Journey;
    pickup: string;
    destination: string;
    depDate: string;
    depTime: string;
    horizon: "T24" | "T72" | ">72h" | "past";
    perBoat: UiBoat[];
    totals: { proj: number; dbTotal: number; maxTotal: number; unassigned: number };
    allBoatsForJourney: Boat[];
    groupsByBoat: Map<UUID, number[]>;
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

      const oArr = ordersByKey.get(`${j.route_id}_${dateISO}`) ?? [];
      const parties: Party[] = oArr
        .map(o => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter(g => g.size > 0);
      if (!parties.length) continue;

      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter(x => x.is_active);
      const allBoatsForJourney: Boat[] = rvaArr
        .map(x => {
          const v = vehicleById.get(x.vehicle_id);
          if (!v || v.active === false) return null;
          const cap = Number(v?.maxseats ?? 0);
          return { vehicle_id: x.vehicle_id, cap: Number.isFinite(cap) ? cap : 0, preferred: !!x.preferred };
        })
        .filter(Boolean) as Boat[];

      const previewAlloc = allocateDetailed(parties, allBoatsForJourney);
      const groupsByBoat = new Map<UUID, number[]>();

      const perBoat: UiBoat[] = [];
      let dbTotal = 0;

      // Read *persisted* allocation (JVA); when empty, fall back to preview for group pills only.
      const locked = locksByJourney.get(j.id) ?? [];
      if (locked.length) {
        const grouped = new Map<UUID, number[]>();
        const seatsByVeh = new Map<UUID, number>();
        for (const row of locked) {
          seatsByVeh.set(row.vehicle_id, (seatsByVeh.get(row.vehicle_id) || 0) + row.seats);
          grouped.set(row.vehicle_id, [...(grouped.get(row.vehicle_id) || []), row.seats]);
        }
        for (const [vehId, seats] of seatsByVeh.entries()) {
          const v = vehicleById.get(vehId);
          if (!v) continue;
          if (!canSeeAll && effectiveOperatorId && v.operator_id !== effectiveOperatorId) continue;

          const groups = (grouped.get(vehId) || []).sort((a, b) => b - a);
          groupsByBoat.set(vehId, groups);
          dbTotal += seats;

          const a = assignByKey.get(`${j.id}_${vehId}`);
          const assignee =
            a && a.staff_id
              ? { staff_id: a.staff_id, name: staffName(a), status: a.status_simple }
              : undefined;

          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === vehId)?.preferred,
            groups,
            canRemove: false,
            assignee,
          });
        }
      } else {
        for (const b of allBoatsForJourney) {
          const v = vehicleById.get(b.vehicle_id);
          if (!v) continue;
          if (!canSeeAll && effectiveOperatorId && v.operator_id !== effectiveOperatorId) continue;

          const entry = previewAlloc.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          const groups = (entry?.orders ?? []).map(o => o.size).sort((a, b) => b - a);
          groupsByBoat.set(b.vehicle_id, groups);
          dbTotal += seats;

          const a = assignByKey.get(`${j.id}_${b.vehicle_id}`);
          const assignee =
            a && a.staff_id
              ? { staff_id: a.staff_id, name: staffName(a), status: a.status_simple }
              : undefined;

          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find(x => x.vehicle_id === b.vehicle_id)?.preferred,
            groups,
            canRemove: false,
            assignee,
          });
        }
      }

      // sort boats: preferred first, then name
      perBoat.sort((a, b) => {
        const ap = a.preferred ? 0 : 1;
        const bp = b.preferred ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.vehicle_name.localeCompare(b.vehicle_name);
      });

      out.push({
        journey: j,
        pickup: pickupNameById.get(r.pickup_id) ?? "—",
        destination: destNameById.get(r.destination_id) ?? "—",
        depDate: dep.toLocaleDateString(),
        depTime: dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        horizon,
        perBoat,
        totals: {
          proj: parties.reduce((s, p) => s + p.size, 0),
          dbTotal,
          maxTotal: allBoatsForJourney.reduce((s, b) => s + b.cap, 0),
          unassigned: 0,
        },
        allBoatsForJourney,
        groupsByBoat,
      });
    }

    out.sort(
      (a, b) =>
        new Date(a.journey.departure_ts).getTime() -
        new Date(b.journey.departure_ts).getTime()
    );

    return out;
  }, [journeys, orders, rvas, vehicles, routes, pickups, destinations, canSeeAll, effectiveOperatorId, locksByJourney, operators, assigns]);

  /* ---------------- Actions ---------------- */
  function onManifest(journeyId: UUID, vehicleId: UUID) {
    window.location.href = `/admin/manifest?journey=${journeyId}&vehicle=${vehicleId}`;
  }

  async function onAssign(journeyId: UUID, vehicleId: UUID, staffId: UUID, horizon?: UiRow["horizon"], dbSeats?: number) {
    if (isLockedWindow(horizon ?? "T24")) {
      alert("Crew changes are locked at T-24.");
      return;
    }
    if (!staffId) return;
    if (!dbSeats || dbSeats <= 0) {
      alert("Cannot assign crew until there is at least 1 paid customer on this boat.");
      return;
    }

    const key = `${journeyId}_${vehicleId}`;
    setAssigning(key);
    try {
      const res = await fetch("/api/ops/assign/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journey_id: journeyId, vehicle_id: vehicleId, staff_id: staffId }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Assign failed");
      }
      const { data: aData } = await sb!
        .from("v_journey_staff_min")
        .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
        .eq("journey_id", journeyId)
        .eq("vehicle_id", vehicleId);
      const updated = (aData || []) as AssignView[];
      setAssigns(prev => {
        const m = new Map(prev.map(p => [`${p.journey_id}_${p.vehicle_id}`, p]));
        updated.forEach(u => m.set(`${u.journey_id}_${u.vehicle_id}`, u));
        return Array.from(m.values());
      });
      setEditingAssignee(prev => ({ ...prev, [key]: false }));
    } catch (e: any) {
      alert(e?.message ?? "Assign failed");
    } finally {
      setAssigning(null);
    }
  }

  const eligibleStaffForVehicle = (vehId: UUID) => {
    const opId = vehicleById.get(vehId)?.operator_id || null;
    const list = staff.filter(s => !opId || s.operator_id === opId);
    list.sort((a, b) => {
      const an = `${a.last_name || ""} ${a.first_name || ""}`.toLowerCase().trim();
      const bn = `${b.last_name || ""} ${b.first_name || ""}`.toLowerCase().trim();
      return an.localeCompare(bn);
    });
    return list;
  };

  /* ---------------- Render ---------------- */
  return (
    <div className="px-6 py-8 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Operator Admin — Live Journeys</h1>
          <p className="text-neutral-600 text-lg">
            You’re seeing <strong>{isSiteAdmin ? (canSeeAll ? "all boats" : "operator filtered") : "only your boats"}</strong>. Manifest matches the site admin view.
          </p>
        </div>

        {/* Site admin operator filter */}
        {isSiteAdmin && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-600">Operator</label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={operatorFilter}
              onChange={e => setOperatorFilter(e.target.value)}
            >
              <option value="ALL">All operators</option>
              {operators
                .slice()
                .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                .map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        {!isSiteAdmin && (
          <div className="text-sm text-neutral-600">
            {psUser?.operator_name ?? (psUser?.operator_admin ? psUser?.operator_id : "")}
          </div>
        )}
      </header>

      {autoErr && (
        <div className="p-3 border rounded-lg bg-amber-50 text-amber-800 text-sm">
          Auto-finalize/assign encountered an issue: {autoErr}
        </div>
      )}

      {/* Only show this error for operator admins without an operator_id */}
      {psLoaded && !isSiteAdmin && !opIdFromUser && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-lg">
          No operator_id found for this login.
        </div>
      )}

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow">
          No upcoming journeys {canSeeAll ? "" : "for your vehicles"}.
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
                  <span className="text-xs text-neutral-700">
                    Proj: <strong>{row.totals.proj}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Customers: <strong>{row.totals.dbTotal}</strong>
                  </span>
                  <span className="text-xs text-neutral-700">
                    Max: <strong>{row.totals.maxTotal}</strong>
                  </span>
                </div>
              </div>

              {/* Table */}
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
                    {row.perBoat.map(b => {
                      const key = `${row.journey.id}_${b.vehicle_id}`;
                      const selected = selectedStaff[key];
                      const perBoatStaff = eligibleStaffForVehicle(b.vehicle_id);
                      const isEditing = !!editingAssignee[key];

                      const showEditControls = !isLockedWindow(row.horizon);

                      const canAssignNow = (b.db || 0) > 0;

                      return (
                        <tr key={key} className="border-t align-top">
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

                          {/* Status + inline assignee (link-style, click-to-edit) */}
                          <td className="p-3">
                            <div className="flex flex-col gap-2">
                              {b.assignee ? (
                                // Captain name looks like a link; clicking toggles the editor.
                                <button
                                  type="button"
                                  className="text-blue-700 underline text-sm text-left disabled:text-neutral-400"
                                  disabled={!showEditControls}
                                  title={showEditControls ? "Change captain" : "Locked at T-24"}
                                  onClick={() =>
                                    setEditingAssignee(prev => ({ ...prev, [key]: !prev[key] }))
                                  }
                                >
                                  {b.assignee.name}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="text-blue-700 underline text-sm text-left disabled:text-neutral-400"
                                  disabled={!showEditControls || !canAssignNow}
                                  title={
                                    !canAssignNow
                                      ? "Cannot assign crew until there is at least 1 paid customer"
                                      : showEditControls
                                      ? "Assign captain"
                                      : "Locked at T-24"
                                  }
                                  onClick={() =>
                                    setEditingAssignee(prev => ({ ...prev, [key]: true }))
                                  }
                                >
                                  Needs crew
                                </button>
                              )}

                              {/* Editor (dropdown) only when editing and not locked */}
                              {isEditing && showEditControls && (
                                <div className="flex items-center gap-2">
                                  {perBoatStaff.length <= 1 ? (
                                    <span className="text-xs">
                                      {perBoatStaff[0]
                                        ? staffName(perBoatStaff[0])
                                        : "No eligible staff"}
                                    </span>
                                  ) : (
                                    <select
                                      className="border rounded px-2 py-1 text-xs"
                                      value={selected || ""}
                                      onChange={e =>
                                        setSelectedStaff(prev => ({
                                          ...prev,
                                          [key]: e.target.value as UUID,
                                        }))
                                      }
                                    >
                                      <option value="">Select captain…</option>
                                      {perBoatStaff.map(s => (
                                        <option key={s.id} value={s.id}>
                                          {staffName(s)}
                                        </option>
                                      ))}
                                    </select>
                                  )}

                                  <button
                                    className="px-2 py-1 rounded text-xs text-white disabled:opacity-40"
                                    style={{ backgroundColor: "#111827" }}
                                    disabled={
                                      !canAssignNow ||
                                      assigning === key ||
                                      (!selected && perBoatStaff.length !== 1)
                                    }
                                    onClick={() =>
                                      onAssign(
                                        row.journey.id,
                                        b.vehicle_id,
                                        (perBoatStaff.length === 1 && !selected
                                          ? perBoatStaff[0]?.id
                                          : selected) as UUID,
                                        row.horizon,
                                        b.db
                                      )
                                    }
                                  >
                                    {assigning === key ? "Assigning…" : "Assign"}
                                  </button>

                                  <button
                                    className="text-[11px] underline self-start text-neutral-600"
                                    onClick={() =>
                                      setEditingAssignee(prev => ({ ...prev, [key]: false }))
                                    }
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="p-3 space-x-2">
                            <button
                              className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                              style={{ backgroundColor: "#2563eb" }}
                              onClick={() => onManifest(row.journey.id, b.vehicle_id)}
                            >
                              Manifest
                            </button>
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
