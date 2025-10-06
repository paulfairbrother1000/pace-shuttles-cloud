"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
type Route = { id: UUID; pickup_id: UUID; destination_id: UUID };
type Pickup = { id: UUID; name: string };
type Destination = { id: UUID; name: string };
type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean };
type Vehicle = { id: UUID; name: string; active: boolean | null; minseats: number | string | null; maxseats: number | string | null; operator_id: UUID | null; };
type Operator = { id: UUID; name: string };
type Order = { id: UUID; status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired"; route_id: UUID | null; journey_date: string | null; qty: number | null; };
type JVALockRow = { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number };

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
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
  if (h <= 24) return "T24";
  if (h <= 72) return "T72";
  return ">72h";
}

type UiBoat = {
  vehicle_id: UUID;
  vehicle_name: string;
  operator_id: UUID | null;
  operator_name: string;
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
};

export default function OperatorAdminPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [operatorId, setOperatorId] = useState<UUID | null>(null);

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
        // who am I -> operator_id
        const { data: me, error: meErr } = await supabase.auth.getUser();
        if (meErr || !me?.user) throw new Error("Not signed in");

        const { data: profile, error: profErr } = await supabase
          .from("profiles")
          .select("operator_id")
          .eq("id", me.user.id)
          .maybeSingle();
        if (profErr || !profile?.operator_id) throw new Error("No operator_id on profile");
        const opId = profile.operator_id as UUID;
        setOperatorId(opId);

        // future active journeys
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

        const [rQ, puQ, deQ, rvaQ, vQ, oQ] = await Promise.all([
          supabase.from("routes").select("id,pickup_id,destination_id").in("id", routeIds),
          supabase.from("pickup_points").select("id,name"),
          supabase.from("destinations").select("id,name"),
          supabase.from("route_vehicle_assignments")
            .select("route_id,vehicle_id,is_active,preferred")
            .in("route_id", routeIds)
            .eq("is_active", true),
          // vehicles filtered to *this* operator
          supabase.from("vehicles")
            .select("id,name,active,minseats,maxseats,operator_id")
            .eq("active", true)
            .eq("operator_id", opId),
          supabase.from("operators").select("id,name"),
        ]);
        if (rQ.error) throw rQ.error;
        if (puQ.error) throw puQ.error;
        if (deQ.error) throw deQ.error;
        if (rvaQ.error) throw rvaQ.error;
        if (vQ.error) throw vQ.error;
        if (oQ.error) throw oQ.error;

        setRoutes((rQ.data || []) as Route[]);
        setPickups((puQ.data || []) as Pickup[]);
        setDestinations((deQ.data || []) as Destination[]);
        setRVAs((rvaQ.data || []) as RVA[]);
        setVehicles((vQ.data || []) as Vehicle[]);
        setOperators((oQ.data || []) as Operator[]);

        // orders (paid) for the horizon covering these journeys
        const dateSet = new Set(js.map(j => toDateISO(new Date(j.departure_ts))));
        const minDate = [...dateSet].sort()[0] ?? toDateISO(new Date());
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", minDate);
        if (oErr) throw oErr;
        setOrders((oData || []) as Order[]);

        // read persisted allocations
        if (journeyIds.length) {
          const { data: lockData, error: lockErr } = await supabase
            .from("journey_allocations")
            .select("journey_id,vehicle_id,order_id,seats:orders(qty)")
            .in("journey_id", journeyIds);
          if (lockErr) throw lockErr;

          // flatten seats from joined orders.qty (optional)
          const m = new Map<UUID, JVALockRow[]>();
          (lockData || []).forEach((row: any) => {
            const arr = m.get(row.journey_id) ?? [];
            arr.push({
              journey_id: row.journey_id,
              vehicle_id: row.vehicle_id,
              order_id: row.order_id,
              seats: Number(row.seats?.qty ?? 0),
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
    return () => { off = true; };
  }, []);

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

  // Build rows but only for this operator’s vehicles
  const rows: UiRow[] = useMemo(() => {
    if (!journeys.length || !operatorId) return [];

    // orders grouped
    const ordersByKey = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
      const k = `${o.route_id}_${o.journey_date}`;
      const arr = ordersByKey.get(k) ?? [];
      arr.push(o);
      ordersByKey.set(k, arr);
    }

    // RVAs by route, but keep only vehicles owned by this operator
    const rvasByRoute = new Map<UUID, RVA[]>();
    for (const r of rvas) {
      const v = vehicleById.get(r.vehicle_id);
      if (!r.is_active || !v || v.operator_id !== operatorId) continue;
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

      // candidate boats = only this operator’s
      const rvaArr = (rvasByRoute.get(j.route_id) ?? []).filter(x => x.is_active);
      const perBoat: UiBoat[] = [];
      let dbTotal = 0;
      const locked = locksByJourney.get(j.id) ?? [];

      // Build from persisted allocation if any
      const byVeh = new Map<UUID, { seats: number; groups: number[] }>();
      for (const row of locked) {
        if (!vehicleById.get(row.vehicle_id)) continue; // not this operator
        const cur = byVeh.get(row.vehicle_id) ?? { seats: 0, groups: [] };
        cur.seats += Number(row.seats || 0);
        cur.groups.push(Number(row.seats || 0));
        byVeh.set(row.vehicle_id, cur);
      }

      for (const x of rvaArr) {
        const v = vehicleById.get(x.vehicle_id);
        if (!v) continue;
        const data = byVeh.get(x.vehicle_id) ?? { seats: 0, groups: [] };
        const maxCap = Math.max(0, Number(v.maxseats ?? 0));
        const minSeats = v.minseats != null ? Number(v.minseats) : null;
        dbTotal += data.seats;

        perBoat.push({
          vehicle_id: x.vehicle_id,
          vehicle_name: v.name ?? "Unknown",
          operator_id: v.operator_id,
          operator_name: v.operator_id ? (operatorNameById.get(v.operator_id) ?? "—") : "—",
          db: data.seats,
          min: minSeats,
          max: maxCap,
          preferred: !!x.preferred,
          groups: data.groups.sort((a,b)=>b-a),
        });
      }

      // totals and row
      const proj = oArr.reduce((s, o) => s + Math.max(0, Number(o.qty ?? 0)), 0);
      const maxTotal = perBoat.reduce((s,b) => s + (b.max ?? 0), 0);
      const unassigned = Math.max(0, proj - dbTotal);

      perBoat.sort((a,b) => {
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
        totals: { proj, dbTotal, maxTotal, unassigned },
      });
    }

    out.sort((a,b) => new Date(a.journey.departure_ts).getTime() - new Date(b.journey.departure_ts).getTime());
    return out;
  }, [journeys, routes, pickups, destinations, rvas, vehicles, operators, orders, locksByJourney, operatorId, routeById, pickupNameById, destNameById, vehicleById, operatorNameById]);

  async function removeBoat(journeyId: UUID, vehicleId: UUID) {
    if (!operatorId) return;
    try {
      const res = await fetch("/api/operator/remove-boat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journeyId, vehicleId, operatorId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to remove");
      // soft refresh: re-run effect by toggling state
      window.location.reload();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Operator Admin — My Journeys</h1>
      </header>

      {err && <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 border rounded-xl bg-white shadow">No journeys for your vehicles.</div>
      ) : (
        <div className="space-y-6">
          {rows.map(row => (
            <section key={row.journey.id} className="rounded-2xl border bg-white shadow overflow-hidden">
              <div className="p-4 flex flex-wrap items-center gap-3 border-b bg-neutral-50">
                <div className="text-lg font-medium">
                  {row.pickup} → {row.destination}
                </div>
                <div className="text-sm text-neutral-600">
                  {row.depDate} · {row.depTime}
                </div>
                <div className="ml-auto">
                  {row.horizon === "T24" ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs">T-24 (Locked)</span>
                  ) : row.horizon === "T72" ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">T-72 (Confirming)</span>
                  ) : row.horizon === ">72h" ? (
                    <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">&gt;72h (Prep)</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">Past</span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left p-3">Boat</th>
                      <th className="text-right p-3">Customers</th>
                      <th className="text-right p-3">Min</th>
                      <th className="text-right p-3">Max</th>
                      <th className="text-left p-3">Groups</th>
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.perBoat.map(b => {
                      // enable Remove if > T-24 AND operator’s other boats (same journey) have enough remaining
                      const canClickTime = row.horizon !== "T24" && row.horizon !== "past";
                      const others = row.perBoat.filter(x => x.vehicle_id !== b.vehicle_id);
                      const otherRemaining = others.reduce((s, x) => s + Math.max(0, (x.max ?? 0) - (x.db ?? 0)), 0);
                      const enoughCapacity = otherRemaining >= (b.db ?? 0);
                      const canRemove = canClickTime && enoughCapacity;

                      return (
                        <tr key={`${row.journey.id}_${b.vehicle_id}`} className="border-t align-top">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{b.vehicle_name}</span>
                              {b.preferred && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">preferred</span>}
                            </div>
                          </td>
                          <td className="p-3 text-right">{b.db}</td>
                          <td className="p-3 text-right">{b.min ?? "—"}</td>
                          <td className="p-3 text-right">{b.max ?? "—"}</td>
                          <td className="p-3">
                            {b.groups.length === 0 ? (
                              <span className="text-neutral-400">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {b.groups.map((g, i) => (
                                  <span key={i} className="inline-flex items-center justify-center rounded-lg border px-2 text-xs" style={{ minWidth: 24, height: 24 }}>
                                    {g}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="p-3 space-x-2">
                            <button
                              className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                              style={{ backgroundColor: "#2563eb" }}
                              onClick={() => (window.location.href = `/admin/manifest?journey=${row.journey.id}&vehicle=${b.vehicle_id}`)}
                            >
                              Manifest
                            </button>
                            <button
                              className={`px-3 py-2 rounded-lg border ${canRemove ? "border-red-600 text-red-600 hover:bg-red-50" : "border-neutral-300 text-neutral-400 cursor-not-allowed"}`}
                              disabled={!canRemove}
                              onClick={() => removeBoat(row.journey.id, b.vehicle_id)}
                              title={
                                canClickTime
                                  ? enoughCapacity ? "Remove this boat and redistribute groups to your other boats" : "Not enough spare capacity on your other boats"
                                  : "Cannot remove at/after T-24"
                              }
                            >
                              Remove
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
