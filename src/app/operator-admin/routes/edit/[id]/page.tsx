"use client";

import Image from "next/image";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type UUID = string;

type PsUser = {
  id: UUID;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Vehicle = {
  id: UUID;
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

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
};

/* ---------- Public-image helper (same as other admin pages) ---------- */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) {
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`
          : `${raw}?v=5`;
      }
      return raw;
    } catch { /* ignore */ }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

/* ---------- Supabase ---------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

export default function OperatorRouteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  /* Operator context is LOCKED from the tiles page via ?op=... */
  const opFromQuery = search.get("op") || "";

  /* ps_user (only to fallback when op= is missing and user is op-admin) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operatorId, setOperatorId] = useState<string>("");

  /* data */
  const [route, setRoute] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Read ps_user and lock operatorId
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      const locked =
        opFromQuery || (u?.operator_admin && u.operator_id)
          ? (opFromQuery || u!.operator_id!)
          : "";
      setOperatorId(locked);
    } catch {
      setPsUser(null);
      setOperatorId(opFromQuery || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load route + current assignments (global)
  useEffect(() => {
    if (!sb) return;
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);

      const [r, a] = await Promise.all([
        sb
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
          .single(),
        sb
          .from("route_vehicle_assignments")
          .select("route_id,vehicle_id,is_active,preferred")
          .eq("is_active", true),
      ]);

      if (off) return;

      if (r.error || !r.data) {
        setMsg(r.error?.message ?? "Route not found.");
      } else {
        const row = r.data as any;
        setRoute({
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup_time: row.pickup_time ?? null,
          approx_duration_mins: row.approx_duration_mins ?? null,
          approximate_distance_miles: row.approximate_distance_miles ?? null,
          pickup: row.pickup
            ? { name: row.pickup.name as string, picture_url: row.pickup.picture_url as string | null }
            : null,
          destination: row.destination
            ? { name: row.destination.name as string, picture_url: row.destination.picture_url as string | null }
            : null,
        });
      }
      if (a.data) setAssignments((a.data as Assignment[]) || []);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [params.id]);

  // Load vehicles for the LOCKED operator
  useEffect(() => {
    if (!sb || !operatorId) return;
    let off = false;
    (async () => {
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

  const assignedForThisRoute = useMemo(() => {
    const ids = new Set(vehicles.map((v) => v.id));
    return assignments.filter((a) => a.route_id === params.id && ids.has(a.vehicle_id));
  }, [assignments, vehicles, params.id]);

  const preferred = assignedForThisRoute.find((a) => a.preferred);
  const assignedIds = new Set(assignedForThisRoute.map((a) => a.vehicle_id));

  async function reloadAssignments() {
    const { data, error } = await sb!
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("is_active", true);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(routeId: string, vehicleId: string, currentlyAssigned: boolean) {
    try {
      if (currentlyAssigned) {
        const { error } = await sb!
          .from("route_vehicle_assignments")
          .update({ is_active: false, preferred: false })
          .eq("route_id", routeId)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await sb!
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
      const { error: clearErr } = await sb!
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", routeId)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      const { error: upErr } = await sb!
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

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <button className="rounded-full border px-3 py-1.5 text-sm" onClick={() => router.push("/operator-admin/routes")}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {route ? `${route.pickup?.name ?? "—"} → ${route.destination?.name ?? "—"}` : "Route"}
        </h1>
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {/* Hero images + facts */}
      <section className="rounded-2xl border bg-white shadow overflow-hidden">
        <div className="grid grid-cols-2 gap-0">
          <div className="relative aspect-[16/7]">
            {publicImage(route?.pickup?.picture_url) ? (
              <Image
                src={publicImage(route?.pickup?.picture_url)!}
                alt={route?.pickup?.name || "Pickup"}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-neutral-100" />
            )}
          </div>
          <div className="relative aspect-[16/7]">
            {publicImage(route?.destination?.picture_url) ? (
              <Image
                src={publicImage(route?.destination?.picture_url)!}
                alt={route?.destination?.name || "Destination"}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-neutral-100" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 text-sm">
          <div>
            <div className="text-neutral-500">Frequency</div>
            <div className="font-medium">{route?.frequency || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Pickup time (local)</div>
            <div className="font-medium">{route?.pickup_time || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Duration</div>
            <div className="font-medium">
              {route?.approx_duration_mins != null ? `${route.approx_duration_mins} mins` : "—"}
            </div>
          </div>
          <div>
            <div className="text-neutral-500">Distance</div>
            <div className="font-medium">
              {route?.approximate_distance_miles != null ? `${route.approximate_distance_miles} mi` : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Vehicle assignment for the LOCKED operator */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-4">
        {!operatorId ? (
          <div className="text-sm text-neutral-500">
            No operator selected. Open this page from the routes list (which sets the operator context).
          </div>
        ) : vehicles.length === 0 ? (
          <div className="text-sm text-neutral-500">No active vehicles for this operator.</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {vehicles.map((v) => {
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
                      title={assigned ? "Unassign" : "Assign to route"}
                      onClick={() => toggleAssign(params.id, v.id, assigned)}
                    >
                      {v.name} ({v.minseats}–{v.maxseats})
                    </button>
                    <button
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        isPref ? "bg-yellow-400 text-black border-yellow-500" : "bg-white text-black border-neutral-300"
                      }`}
                      title="Mark as preferred"
                      onClick={() => setPreferred(params.id, v.id)}
                    >
                      ★
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="text-sm">
              Preferred:&nbsp;
              <span className="font-medium">
                {preferred ? vehicles.find((v) => v.id === preferred.vehicle_id)?.name ?? "—" : "—"}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
