"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  pickup: { name: string; picture_url: string | null } | null;
  destination: { name: string; picture_url: string | null } | null;
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

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function signedUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* ===================================================================== */

export default function OperatorRouteDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const search = useSearchParams();
  const preselectedOp = search.get("op") || "";

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* Operator context (we keep the op from the tiles page) */
  const [operatorId, setOperatorId] = useState(preselectedOp);

  /* Data */
  const [route, setRoute] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pickupUrl, setPickupUrl] = useState<string | null>(null);
  const [destUrl, setDestUrl] = useState<string | null>(null);

  /* UI */
  const [msg, setMsg] = useState<string | null>(null);

  /* Read ps_user once */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (!preselectedOp && u?.operator_admin && u.operator_id) {
        setOperatorId(u.operator_id);
      }
    } catch {
      setPsUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Load the route (with pickup/destination + pictures) */
  useEffect(() => {
    let off = false;
    (async () => {
      setMsg(null);
      const { data, error } = await sb
        .from("routes")
        .select(
          `
          id,
          route_name,
          name,
          frequency,
          pickup_time,
          approx_duration_mins,
          approximate_distance_miles,
          pickup:pickup_id ( name, picture_url ),
          destination:destination_id ( name, picture_url )
        `
        )
        .eq("id", params.id)
        .single();

      if (off) return;

      if (error || !data) {
        setMsg(error?.message || "Route not found.");
        setRoute(null);
        return;
      }

      const r: RouteRow = {
        id: data.id,
        route_name: data.route_name ?? null,
        name: data.name ?? null,
        frequency: data.frequency ?? null,
        pickup_time: data.pickup_time ?? null,
        approx_duration_mins: data.approx_duration_mins ?? null,
        approximate_distance_miles: data.approximate_distance_miles ?? null,
        pickup: data.pickup
          ? {
              name: String(data.pickup.name),
              picture_url: data.pickup.picture_url ?? null,
            }
          : null,
        destination: data.destination
          ? {
              name: String(data.destination.name),
              picture_url: data.destination.picture_url ?? null,
            }
          : null,
      };

      setRoute(r);

      // images
      const [p, d] = await Promise.all([
        signedUrl(r.pickup?.picture_url ?? null),
        signedUrl(r.destination?.picture_url ?? null),
      ]);
      setPickupUrl(p);
      setDestUrl(d);
    })();
    return () => {
      off = true;
    };
  }, [params.id]);

  /* Load vehicles for the operator in context */
  useEffect(() => {
    if (!operatorId) return;
    let off = false;
    (async () => {
      const { data, error } = await sb
        .from("vehicles")
        .select("id,name,minseats,maxseats,active,operator_id")
        .eq("operator_id", operatorId)
        .eq("active", true)
        .order("name");
      if (off) return;
      if (error) setMsg(error.message);
      setVehicles((data as Vehicle[]) || []);
    })();
    return () => {
      off = true;
    };
  }, [operatorId]);

  /* Load current assignments for this route */
  async function reloadAssignments() {
    const { data, error } = await sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", params.id)
      .eq("is_active", true);
    if (error) setMsg(error.message);
    setAssignments((data as Assignment[]) || []);
  }
  useEffect(() => {
    reloadAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const preferred = useMemo(
    () => assignments.find((a) => a.preferred),
    [assignments]
  );
  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.vehicle_id)),
    [assignments]
  );

  /* Actions */
  async function toggleAssign(vehicleId: string, assigned: boolean) {
    try {
      if (assigned) {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .update({ is_active: false, preferred: false })
          .eq("route_id", params.id)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .upsert(
            {
              route_id: params.id,
              vehicle_id: vehicleId,
              is_active: true,
              preferred: false,
            },
            { onConflict: "route_id,vehicle_id" }
          );
        if (error) throw error;
      }
      await reloadAssignments();
    } catch (e: any) {
      setMsg(e.message ?? "Unable to update.");
    }
  }

  async function setPreferred(vehicleId: string) {
    try {
      const { error: clearErr } = await sb
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", params.id)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      const { error } = await sb
        .from("route_vehicle_assignments")
        .upsert(
          {
            route_id: params.id,
            vehicle_id: vehicleId,
            is_active: true,
            preferred: true,
          },
          { onConflict: "route_id,vehicle_id" }
        );
      if (error) throw error;

      await reloadAssignments();
    } catch (e: any) {
      setMsg(e.message ?? "Unable to set preferred.");
    }
  }

  /* Render */
  if (!route) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-semibold">Route</h1>
        <p className="mt-2 text-neutral-600">{msg || "Loading…"}</p>
      </div>
    );
  }

  const title = route.route_name || route.name || "Route";
  const sub = `${route.pickup?.name ?? "—"} → ${route.destination?.name ?? "—"}`;

  return (
    <div className="p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-neutral-600">{sub}</p>
      </header>

      {/* Collage */}
      <div className="rounded-2xl overflow-hidden border bg-white shadow">
        <div className="flex h-64 w-full">
          <img
            src={pickupUrl ?? ""}
            alt={route.pickup?.name || "pickup"}
            className="w-1/2 h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
            }}
          />
          <img
            src={destUrl ?? ""}
            alt={route.destination?.name || "destination"}
            className="w-1/2 h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 p-4 text-sm text-neutral-700">
          <div>
            <div className="text-neutral-500">Frequency</div>
            <div>{route.frequency ?? "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Pickup time (local)</div>
            <div>{route.pickup_time ?? "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Duration</div>
            <div>{route.approx_duration_mins ?? "—"} mins</div>
          </div>
          <div>
            <div className="text-neutral-500">Distance</div>
            <div>{route.approximate_distance_miles ?? "—"} mi</div>
          </div>
        </div>
      </div>

      {/* Operator context (locked if op admin). We DO NOT force re-selection. */}
      <div className="rounded-2xl border bg-white shadow p-4 flex items-center gap-3">
        <div className="text-sm text-neutral-600">Operator</div>
        {operatorLocked ? (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            {psUser?.operator_name || psUser?.operator_id}
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
            {operatorId || "—"}
          </div>
        )}
        {msg && <span className="ml-auto text-sm text-neutral-600">{msg}</span>}
      </div>

      {/* Assignment controls */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-3">
        <div className="text-sm text-neutral-600">Select vehicles</div>
        <div className="flex flex-wrap gap-2">
          {vehicles.length === 0 ? (
            <span className="text-sm text-neutral-500">
              No active vehicles for this operator.
            </span>
          ) : (
            vehicles.map((v) => {
              const assigned = assignedIds.has(v.id);
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
                    title={
                      assigned ? "Unassign from route" : "Assign to route"
                    }
                    onClick={() => toggleAssign(v.id, assigned)}
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
                    onClick={() => setPreferred(v.id)}
                  >
                    ★
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="text-sm text-neutral-600">
          Preferred:{" "}
          <span className="font-medium">
            {preferred
              ? vehicles.find((v) => v.id === preferred.vehicle_id)?.name ?? "—"
              : "—"}
          </span>
        </div>
      </section>
    </div>
  );
}
