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

      return {
        id: user.id,
        operator_admin: opAdmin,
        operator_id: claim ? String(claim) : null,
        operator_name:
          (meta.operator_name ??
            appm.operator_name ??
            meta?.ps_user?.operator_name ??
            appm?.ps_user?.operator_name) || null,
        site_admin: siteAdmin,
      };
    }
  } catch {}

  try {
    const { data: ures } = await sb.auth.getUser();
    const uid = ures?.user?.id;
    if (!uid) return null;

    const { data } = await sb
      .from("profiles")
      .select("id, operator_admin, operator_id, site_admin")
      .eq("id", uid)
      .maybeSingle();

    if (!data) return null;

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
  journey_date: string | null;
  qty: number | null;
};
type JVALockRow = { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number };

type AssignView = {
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID;
  status_simple: "allocated" | "confirmed" | "complete";
  first_name: string | null;
  last_name: string | null;
  role_label?: string | null;
};

/* ---------------- Helpers ---------------- */
const toDateISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

function horizonFor(tsISO: string): "T24" | "T72" | ">72h" | "past" {
  const now = new Date();
  const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (h <= 24) return "T24";
  if (h <= 72) return "T72";
  return ">72h";
}

/* ---------------- Allocation ---------------- */
type Party = { order_id: UUID; size: number };
type Boat = { vehicle_id: UUID; cap: number; preferred: boolean };

type DetailedAlloc = {
  byBoat: Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>;
  unassigned: { order_id: UUID; size: number }[];
  total: number;
};

function allocateDetailed(parties: Party[], boats: Boat[]): DetailedAlloc {
  const sorted = [...(parties ?? [])]
    .filter((p) => p.size > 0)
    .sort((a, b) => b.size - a.size);

  const state = (boats ?? []).map((b) => ({
    vehicle_id: b.vehicle_id,
    cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
    used: 0,
    preferred: !!b.preferred,
  }));

  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  const unassigned: { order_id: UUID; size: number }[] = [];

  for (const g of sorted) {
    const candidates = state
      .map((s) => ({ id: s.vehicle_id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter((c) => c.free >= g.size)
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

/* ============================================================
   StatusCell — now queries Supabase directly (no custom API)
   ============================================================ */
type Candidate = {
  staff_id: string;
  full_name: string | null;
  priority: number;
  is_lead_eligible: boolean;
  currently_assigned: boolean;
  currently_confirmed: boolean;
};

function StatusCell({ journeyId, vehicleId }: { journeyId: string; vehicleId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] =
    useState<"allocated" | "confirmed" | "complete" | null>(null);

  async function load() {
    if (!sb) return;
    setLoading(true);
    setErr(null);
    try {
      // current captain (lead) from the min view
      const { data: cur } = await sb
        .from("v_crew_assignments_min")
        .select("staff_id, status_simple, role_label")
        .eq("journey_id", journeyId)
        .eq("vehicle_id", vehicleId);

      const lead = (cur || []).find(
        (r: any) => String(r.role_label || "").toLowerCase() !== "crew"
      );
      setCurrentId(lead?.staff_id ?? null);
      setCurrentStatus((lead?.status_simple as any) ?? null);

      // candidate list from v_captain_candidates
      const { data: cand, error } = await sb
        .from("v_captain_candidates")
        .select(
          "staff_id, full_name, priority, is_lead_eligible, currently_assigned, currently_confirmed"
        )
        .eq("journey_id", journeyId)
        .eq("vehicle_id", vehicleId)
        .order("priority", { ascending: true });

      if (error) throw error;
      setCandidates((cand as any[]) || []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [journeyId, vehicleId]);

  const label = useMemo(() => {
    if (!currentId) return "Unassigned";
    const cur = candidates.find((c) => c.staff_id === currentId);
    if (!cur) return "Assigned";
    return cur.currently_confirmed ? `${cur.full_name ?? "Captain"} Confirmed` : `${cur.full_name ?? "Captain"} Assigned`;
  }, [currentId, candidates]);

  async function assign(staffId: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/ops/assign/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ journey_id: journeyId, vehicle_id: vehicleId, staff_id: staffId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Assign failed (${res.status})`);
      await load();
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Assign failed");
    } finally {
      setLoading(false);
    }
  }

  if (loading && !candidates.length) {
    return <span className="text-xs text-neutral-500">Loading…</span>;
  }
  if (err && !candidates.length) {
    return <span className="text-xs text-red-600">{err}</span>;
  }

  return (
    <div className="relative inline-block">
      <button className="underline text-left" onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="absolute z-20 mt-2 bg-white border rounded shadow p-2 min-w-[240px]">
          <div className="text-xs mb-1 text-neutral-600">Assign captain</div>
          <select
            className="w-full border rounded px-2 py-1 text-sm"
            defaultValue={currentId ?? ""}
            onChange={(e) => e.target.value && assign(e.target.value)}
          >
            <option value="" disabled>
              Select…
            </option>
            {candidates.map((c) => (
              <option key={c.staff_id} value={c.staff_id}>
                {`P${c.priority} • ${c.full_name ?? "Unnamed"}${
                  c.is_lead_eligible ? "" : " (not lead)"
                }`}
              </option>
            ))}
          </select>
          {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Page (unchanged outside of StatusCell usage) ---------------- */
type UiBoat = {
  vehicle_id: UUID;
  vehicle_name: string;
  operator_name: string;
  operator_id?: UUID | null;
  db: number;
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
  horizon: "T24" | "T72" | ">72h" | "past";
  perBoat: UiBoat[];
  totals: { proj: number; dbTotal: number; maxTotal: number; unassigned: number };
  allBoatsForJourney: Boat[];
  groupsByBoat: Map<UUID, number[]>;
};

export default function OperatorAdminJourneysPage() {
  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [psLoaded, setPsLoaded] = useState(false);

  const [operatorFilter, setOperatorFilter] = useState<UUID | "all">("all");

  useEffect(() => {
    let off = false;
    (async () => {
      const fromLocal = readPsUserLocal();
      const resolved = fromLocal?.operator_admin && (fromLocal.operator_id || fromLocal.site_admin)
        ? fromLocal
        : await resolveOperatorFromAuthOrProfile();

      if (!off) {
        setPsUser(resolved);
        if (resolved?.operator_admin && resolved.operator_id && !resolved.site_admin) {
          setOperatorFilter(resolved.operator_id);
        } else {
          setOperatorFilter("all");
        }
        setPsLoaded(true);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

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
        const routeIds = Array.from(new Set(js.map((j) => j.route_id)));
        const journeyIds = js.map((j) => j.id);

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

        const dateSet = new Set(js.map((j) => toDateISO(new Date(j.departure_ts))));
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
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [psLoaded, operatorFilter]);

  /* ---------------- Lookups ---------------- */
  const [routes, setRoutes] = useState<Route[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [rvas, setRVAs] = useState<RVA[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);

  const routeById = useMemo(() => {
    const m = new Map<UUID, Route>();
    (routes ?? []).forEach((r) => m.set(r.id, r));
    return m;
  }, [routes]);

  const pickupNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    (pickups ?? []).forEach((p) => m.set(p.id, p.name));
    return m;
  }, [pickups]);

  const destNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    (destinations ?? []).forEach((d) => m.set(d.id, d.name));
    return m;
  }, [destinations]);

  const vehicleById = useMemo(() => {
    const m = new Map<UUID, Vehicle>();
    (vehicles ?? []).forEach((v) => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const operatorNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    (operators ?? []).forEach((o) => m.set(o.id, o.name || "—"));
    return m;
  }, [operators]);

  /* ---------------- Build rows ---------------- */
  type UiBoat = {
    vehicle_id: UUID;
    vehicle_name: string;
    operator_name: string;
    operator_id?: UUID | null;
    db: number;
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
    horizon: "T24" | "T72" | ">72h" | "past";
    perBoat: UiBoat[];
    totals: { proj: number; dbTotal: number; maxTotal: number; unassigned: number };
    allBoatsForJourney: Boat[];
    groupsByBoat: Map<UUID, number[]>;
  };

  const rows: UiRow[] = useMemo(() => {
    if (!(journeys ?? []).length) return [];

    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders ?? []) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const k = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(k) ?? [];
      arr.push(o);
      ordersByKey.set(k, arr);
    }

    const rvasByRoute = new Map<UUID, RVA[]>();
    for (const r of rvas ?? []) {
      if (!r.is_active) continue;
      const arr = rvasByRoute.get(r.route_id) ?? [];
      arr.push(r);
      rvasByRoute.set(r.route_id, arr);
    }

    const out: UiRow[] = [];

    for (const j of journeys ?? []) {
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
      const allBoatsForJourney: Boat[] = rvaArr
        .map((x) => {
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

      const locked = (locksByJourney.get(j.id) ?? []);
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
          const groups = (grouped.get(vehId) || []).sort((a, b) => b - a);
          groupsByBoat.set(vehId, groups);
          dbTotal += seats;

          perBoat.push({
            vehicle_id: vehId,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find?.((x) => x.vehicle_id === vehId)?.preferred,
            groups,
          });
        }
      } else {
        for (const b of allBoatsForJourney) {
          const v = vehicleById.get(b.vehicle_id);
          if (!v) continue;

          const entry = previewAlloc.byBoat.get(b.vehicle_id);
          const seats = entry?.seats ?? 0;
          const groups = (entry?.orders ?? []).map((o) => o.size).sort((a, b) => b - a);
          groupsByBoat.set(b.vehicle_id, groups);
          dbTotal += seats;

          perBoat.push({
            vehicle_id: b.vehicle_id,
            vehicle_name: v?.name ?? "Unknown",
            operator_name: v?.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
            operator_id: v?.operator_id ?? null,
            db: seats,
            min: v?.minseats != null ? Number(v.minseats) : null,
            max: v?.maxseats != null ? Number(v.maxseats) : null,
            preferred: !!rvaArr.find?.((x) => x.vehicle_id === b.vehicle_id)?.preferred,
            groups,
          });
        }
      }

      const perBoatFiltered =
        operatorFilter === "all"
          ? perBoat
          : perBoat.filter((b) => (b as any).operator_id === operatorFilter);

      if (perBoatFiltered.length === 0) continue;

      perBoatFiltered.sort((a, b) => {
        const ap = (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0);
        if (ap !== 0) return ap;
        return a.vehicle_name.localeCompare(b.vehicle_name);
      });

      out.push({
        journey: j,
        pickup: pickupNameById.get(r.pickup_id) ?? "—",
        destination: destNameById.get(r.destination_id) ?? "—",
        depDate: dep.toLocaleDateString(),
        depTime: dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        horizon,
        perBoat: perBoatFiltered,
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
  }, [
    journeys,
    orders,
    rvas,
    vehicles,
    routes,
    pickups,
    destinations,
    locksByJourney,
    operators,
    operatorFilter,
    routeById,
    pickupNameById,
    destNameById,
    vehicleById,
    operatorNameById,
  ]);

  /* ---------------- Actions ---------------- */
  function onManifest(journeyId: UUID, vehicleId: UUID) {
    window.location.href = `/admin/manifest?journey=${journeyId}&vehicle=${vehicleId}`;
  }

  const isOperatorLocked =
    !!psUser?.operator_admin && !!psUser?.operator_id && !psUser?.site_admin;

  const headerSubtitle =
    operatorFilter === "all"
      ? "You’re seeing all operators’ boats."
      : "You’re seeing only the selected operator’s boats.";

  /* ---------------- Render ---------------- */
  return (
    <div className="px-6 py-8 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Operator Admin — Live Journeys</h1>
          <p className="text-neutral-600 text-lg">
            <strong>{headerSubtitle}</strong> Manifest matches the site admin view.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm text-neutral-700">Operator:</label>
          <select
            className="border rounded-lg px-2 py-1 text-sm"
            value={operatorFilter}
            onChange={(e) => setOperatorFilter((e.target.value || "all") as any)}
            disabled={isOperatorLocked}
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
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow">
          {operatorFilter === "all"
            ? "No upcoming journeys for any operator."
            : "No upcoming journeys for this operator."}
        </div>
      ) : (
        <div className="space-y-6">
          {rows.map((row) => (
            <section
              key={row.journey.id}
              className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden"
            >
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
                    {row.perBoat.map((b) => {
                      const key = `${row.journey.id}_${b.vehicle_id}`;
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

                          {/* NEW Status cell with inline assignment dropdown */}
                          <td className="p-3">
                            <StatusCell journeyId={row.journey.id} vehicleId={b.vehicle_id} />
                          </td>

                          <td className="p-3 space-x-2">
                            {(row.horizon === "T72" || row.horizon === ">72h") && (
                              <button
                                className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                                style={{ backgroundColor: "#2563eb" }}
                                onClick={() => onManifest(row.journey.id, b.vehicle_id)}
                              >
                                Manifest
                              </button>
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
