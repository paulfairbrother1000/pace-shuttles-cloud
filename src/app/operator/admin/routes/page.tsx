"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  first_name?: string | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string; logo_url?: string | null };

type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string } | null;
  destination?: { name: string } | null;
};

type Vehicle = {
  id: string;
  name: string;
  minseats: number | string;
  maxseats: number | string;
  active: boolean | null;
  operator_id: string | null;
};

type Assignment = {
  route_id: string;
  vehicle_id: string;
  is_active: boolean;
  preferred: boolean;
};

/* ---------- Page ---------- */
export default function OperatorRoutesPage() {
  /* ps_user (same approach as Staff page) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

  /* Operator context */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>("");

  /* Data */
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  /* UI */
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Read ps_user once and pre-select operator for operator admins */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.operator_admin && u.operator_id) {
        setOperatorId((cur) => cur || u.operator_id!);
      }
    } catch {
      setPsUser(null);
    }
  }, []);

  /* Pretty operator name like other pages */
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);
  const lockedOperatorName =
    (operatorLocked &&
      (psUser?.operator_name ||
        operators.find((o) => o.id === psUser!.operator_id!)?.name)) ||
    "";

  /* Initial lookups + routes (routes are global; assignments are global/active) */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);

      const [ops, r, a] = await Promise.all([
        sb.from("operators").select("id,name,logo_url").order("name"),
        sb
          .from("routes")
          .select(
            `
            id,
            route_name,
            name,
            frequency,
            pickup:pickup_id ( name ),
            destination:destination_id ( name )
          `
          )
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        sb
          .from("route_vehicle_assignments")
          .select("route_id,vehicle_id,is_active,preferred")
          .eq("is_active", true),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.data) {
        const rows: RouteRow[] = ((r.data as any[]) || []).map((row) => ({
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup: row.pickup ? { name: row.pickup.name as string } : null,
          destination: row.destination ? { name: row.destination.name as string } : null,
        }));
        setRoutes(rows);
      }
      if (a.data) setAssignments((a.data as Assignment[]) || []);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Load vehicles for the current operator context */
  useEffect(() => {
    if (!operatorId) return;
    let off = false;
    (async () => {
      setMsg(null);
      const { data, error } = await sb
        .from("vehicles")
        .select("id,name,minseats,maxseats,active,operator_id")
        .eq("operator_id", operatorId)
        .eq("active", true)
        .order("name");
      if (!off) {
        if (error) setMsg(error.message);
        setVehicles((data as Vehicle[]) || []);
      }
    })();
    return () => {
      off = true;
    };
  }, [operatorId]);

  /* Derived: keep only assignments whose vehicle belongs to the current operator */
  const assignmentsByRoute = useMemo(() => {
    const allowedVehicleIds = new Set(vehicles.map((v) => v.id));
    const filtered = assignments.filter((a) => allowedVehicleIds.has(a.vehicle_id));
    const m = new Map<string, Assignment[]>();
    filtered.forEach((a) => {
      if (!m.has(a.route_id)) m.set(a.route_id, []);
      m.get(a.route_id)!.push(a);
    });
    return m;
  }, [assignments, vehicles]);

  async function reloadAssignments() {
    const { data, error } = await sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("is_active", true);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  /* Actions (direct Supabase writes) */
  async function toggleAssign(routeId: string, vehicleId: string, currentlyAssigned: boolean) {
    try {
      if (currentlyAssigned) {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .update({ is_active: false, preferred: false })
          .eq("route_id", routeId)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .upsert(
            { route_id: routeId, vehicle_id: vehicleId, is_active: true, preferred: false },
            { onConflict: "route_id,vehicle_id" }
          );
        if (error) throw error;
      }
      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to update");
    }
  }

  async function setPreferred(routeId: string, vehicleId: string) {
    try {
      // clear existing
      const { error: clearErr } = await sb
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", routeId)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      // set new preferred (ensures row exists)
      const { error: upErr } = await sb
        .from("route_vehicle_assignments")
        .upsert(
          { route_id: routeId, vehicle_id: vehicleId, is_active: true, preferred: true },
          { onConflict: "route_id,vehicle_id" }
        );
      if (upErr) throw upErr;

      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to set preferred");
    }
  }

  /* UI */
  const locked = operatorLocked;

  return (
    <div className="p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">
          Assign vehicles to each route. Choose one <em>Preferred</em> vehicle per route.
          {locked && (
            <> Showing routes for <strong>{lockedOperatorName || psUser?.operator_id}</strong>.</>
          )}
        </p>
      </header>

      {/* Operator context — same UX as Staff page */}
      <div className="rounded-2xl border bg-white shadow p-4 flex items-center gap-3">
        <div className="text-sm text-neutral-600">Operator</div>

        {locked ? (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            {lockedOperatorName || psUser?.operator_id}
          </div>
        ) : (
          <select
            className="border rounded-lg px-3 py-2"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
          >
            <option value="">— Select —</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}

        {msg && <span className="ml-auto text-sm text-neutral-600">{msg}</span>}
      </div>

      {/* Table */}
      <section className="rounded-2xl border bg-white overflow-hidden shadow">
        {loading ? (
          <div className="p-4">Loading…</div>
        ) : !operatorId ? (
          <div className="p-4">
            {locked ? "No operator is linked to this account." : "Choose an Operator to assign vehicles."}
          </div>
        ) : routes.length === 0 ? (
          <div className="p-4">No routes.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left p-3">Route</th>
                <th className="text-left p-3">Pick-up</th>
                <th className="text-left p-3">Destination</th>
                <th className="text-left p-3">Select Vehicles</th>
                <th className="text-left p-3">Assigned (Preferred)</th>
                <th className="text-left p-3">Frequency</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const asnForRoute = assignmentsByRoute.get(r.id) || [];
                const preferred = asnForRoute.find((a) => a.preferred);
                const assignedVehicleIds = new Set(asnForRoute.map((a) => a.vehicle_id));

                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3 w-[22%]">
                      <div className="font-medium">{r.route_name || r.name || "Route"}</div>
                    </td>
                    <td className="p-3 w-[16%]">{r.pickup?.name ?? "—"}</td>
                    <td className="p-3 w-[16%]">{r.destination?.name ?? "—"}</td>

                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        {vehicles.length === 0 ? (
                          <span className="text-sm text-neutral-500">No active vehicles</span>
                        ) : (
                          vehicles.map((v) => {
                            const assigned = assignedVehicleIds.has(v.id);
                            const isPref = preferred?.vehicle_id === v.id;
                            return (
                              <div
                                key={v.id}
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                                  assigned ? "bg-black text-white border-black" : "bg-white"
                                }`}
                              >
                                <button
                                  className="outline-none"
                                  title={assigned ? "Unassign from route" : "Assign to route"}
                                  onClick={() => toggleAssign(r.id, v.id, assigned)}
                                >
                                  {v.name} ({v.minseats}–{v.maxseats})
                                </button>
                                <button
                                  className={`rounded-full border px-2 py-0.5 text-xs ${
                                    isPref
                                      ? "bg-yellow-400 text-black border-yellow-500"
                                      : "bg-white text-black border-neutral-300"
                                  }`}
                                  title="Mark as preferred"
                                  onClick={() => setPreferred(r.id, v.id)}
                                >
                                  ★
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </td>

                    <td className="p-3 w-[16%]">
                      {preferred ? (
                        <div className="font-medium">
                          {vehicles.find((v) => v.id === preferred.vehicle_id)?.name ?? "—"}
                        </div>
                      ) : (
                        <span className="text-neutral-500">—</span>
                      )}
                    </td>

                    <td className="p-3 w-[12%]">{r.frequency ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
