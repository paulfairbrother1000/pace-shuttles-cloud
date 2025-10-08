"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = { id: string; operator_admin?: boolean | null; operator_id?: string | null; operator_name?: string | null };
type Operator = { id: string; name: string };
type Vehicle = { id: string; name: string; minseats: number; maxseats: number; active: boolean | null; operator_id: string | null };
type Assignment = { route_id: string; vehicle_id: string; is_active: boolean; preferred: boolean };
type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
};

/* ---------- Image helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function OperatorRouteDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const urlOp = search.get("op") || "";

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
    } catch { setPsUser(null); }
  }, []);

  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);
  const initialOperatorId = operatorLocked ? (psUser?.operator_id || "") : urlOp;

  /* operator + vehicles */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>(initialOperatorId);

  const [route, setRoute] = useState<RouteRow | null>(null);
  const [pUrl, setPUrl] = useState<string | null>(null);
  const [dUrl, setDUrl] = useState<string | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  /* load operators + route */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, r] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb
          .from("routes")
          .select(`
            id,
            route_name,
            name,
            frequency,
            pickup_time,
            approx_duration_mins,
            approximate_distance_miles,
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `)
          .eq("id", params.id)
          .single(),
      ]);
      if (off) return;

      setOperators((ops.data as Operator[]) || []);

      if (!r.error && r.data) {
        const row = r.data as any;
        const mapped: RouteRow = {
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup_time: row.pickup_time ?? null,
          approx_duration_mins: row.approx_duration_mins ?? null,
          approximate_distance_miles: row.approximate_distance_miles ?? null,
          pickup: row.pickup ? { name: row.pickup.name, picture_url: row.pickup.picture_url } : null,
          destination: row.destination ? { name: row.destination.name, picture_url: row.destination.picture_url } : null,
        };
        setRoute(mapped);

        const [rp, rd] = await Promise.all([
          resolveStorageUrl(mapped.pickup?.picture_url ?? null),
          resolveStorageUrl(mapped.destination?.picture_url ?? null),
        ]);
        setPUrl(rp);
        setDUrl(rd);
      }
      setLoading(false);
    })();
    return () => { off = true; };
  }, [params.id]);

  /* load vehicles for operatorId + assignments for route */
  useEffect(() => {
    if (!operatorId) return;
    let off = false;
    (async () => {
      const [vs, asn] = await Promise.all([
        sb.from("vehicles").select("id,name,minseats,maxseats,active,operator_id").eq("operator_id", operatorId).eq("active", true).order("name"),
        sb.from("route_vehicle_assignments").select("route_id,vehicle_id,is_active,preferred").eq("route_id", params.id),
      ]);
      if (!off) {
        setVehicles((vs.data as Vehicle[]) || []);
        setAssignments(((asn.data as Assignment[]) || []).filter(a => a.is_active));
      }
    })();
    return () => { off = true; };
  }, [operatorId, params.id]);

  const assignedIds = useMemo(() => new Set(assignments.map(a => a.vehicle_id)), [assignments]);
  const preferred = useMemo(() => assignments.find(a => a.preferred), [assignments]);

  async function reloadAssignments() {
    const { data } = await sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", params.id);
    setAssignments(((data as Assignment[]) || []).filter(a => a.is_active));
  }

  async function toggleAssign(vehicleId: string, currentlyAssigned: boolean) {
    if (!route) return;
    if (currentlyAssigned) {
      await sb.from("route_vehicle_assignments")
        .update({ is_active: false, preferred: false })
        .eq("route_id", route.id)
        .eq("vehicle_id", vehicleId);
    } else {
      await sb.from("route_vehicle_assignments")
        .upsert({ route_id: route.id, vehicle_id: vehicleId, is_active: true, preferred: false }, { onConflict: "route_id,vehicle_id" });
    }
    await reloadAssignments();
  }

  async function setPreferred(vehicleId: string) {
    if (!route) return;
    await sb.from("route_vehicle_assignments").update({ preferred: false }).eq("route_id", route.id).eq("preferred", true);
    await sb.from("route_vehicle_assignments").upsert(
      { route_id: route.id, vehicle_id: vehicleId, is_active: true, preferred: true },
      { onConflict: "route_id,vehicle_id" }
    );
    await reloadAssignments();
  }

  const title = route?.route_name || route?.name || "Route";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/operator-admin/routes${operatorId ? `?op=${operatorId}` : ""}`} className="rounded-full border px-3 py-1">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>

      {/* collage + meta */}
      <div className="rounded-2xl border bg-white overflow-hidden shadow">
        <div className="grid grid-cols-2 h-64 sm:h-80">
          <div
            className="bg-neutral-100"
            style={{
              backgroundImage: pUrl ? `url(${pUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-label={route?.pickup?.name || ""}
          />
          <div
            className="bg-neutral-100"
            style={{
              backgroundImage: dUrl ? `url(${dUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-label={route?.destination?.name || ""}
          />
        </div>

        <div className="p-4 grid sm:grid-cols-4 gap-4 text-sm text-neutral-700">
          <div>
            <div className="text-neutral-500">Frequency</div>
            <div>{route?.frequency || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Pickup time (local)</div>
            <div>{route?.pickup_time || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Duration</div>
            <div>{route?.approx_duration_mins ? `${route.approx_duration_mins} mins` : "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Distance</div>
            <div>{route?.approximate_distance_miles ?? "—"} {route?.approximate_distance_miles ? "mi" : ""}</div>
          </div>
        </div>
      </div>

      {/* operator context (only if not locked AND no op in url) */}
      {!initialOperatorId && !operatorLocked && (
        <div className="rounded-2xl border bg-white shadow p-4 flex items-center gap-3">
          <label className="text-sm text-neutral-700">Operator</label>
          <select className="border rounded-lg px-3 py-2" value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
            <option value="">— Select —</option>
            {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}

      {/* vehicles */}
      <div className="rounded-2xl border bg-white shadow p-4">
        {!operatorId ? (
          <div>Select an operator to assign vehicles.</div>
        ) : vehicles.length === 0 ? (
          <div>No active vehicles for this operator.</div>
        ) : (
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
                  <button onClick={() => toggleAssign(v.id, assigned)} title={assigned ? "Unassign" : "Assign"}>
                    {v.name} ({v.minseats}–{v.maxseats})
                  </button>
                  <button
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      isPref ? "bg-yellow-400 text-black border-yellow-500" : "bg-white text-black border-neutral-300"
                    }`}
                    title="Preferred"
                    onClick={() => setPreferred(v.id)}
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
