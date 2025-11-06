"use client";

import Image from "next/image";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

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
  // journey_type_id: string | null; // ← removed (column not present)
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
  pickup?: { id?: string; name: string; picture_url: string | null } | null;
  destination?: { id?: string; name: string; picture_url: string | null } | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  journey_type_id: string | null;
};

type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: UUID; journey_type_id: UUID };

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
    } catch {}
  }
  if (raw.startsWith("/storage/v1/object/public/")) return `https://${supaHost}${raw}?v=5`;
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    : null;

export default function OperatorRouteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const isCreate = params.id === "new";

  const opFromQuery = search.get("op") || "";

  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operatorId, setOperatorId] = useState<string>("");

  const [route, setRoute] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string; picture_url: string | null }[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingJT, setSavingJT] = useState(false);
  const [savingCore, setSavingCore] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      const locked = opFromQuery || (u?.operator_admin && u.operator_id) ? (opFromQuery || u!.operator_id!) : "";
      setOperatorId(locked);
    } catch {
      setPsUser(null);
      setOperatorId(opFromQuery || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load lookups (journey types + operator type permissions + destinations for pickers)
  useEffect(() => {
    if (!sb) return;
    (async () => {
      const [j, rels, d] = await Promise.all([
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb.from("destinations").select("id,name,picture_url").order("name"), // assumes 'destinations' table
      ]);
      setJourneyTypes((j.data as JourneyType[]) || []);
      setOpTypeRels((rels.data as OperatorTypeRel[]) || []);
      setDestinations((d.data as any[]) || []);
    })();
  }, []);

  // load route + assignments (skip on create)
  useEffect(() => {
    if (!sb) return;
    if (isCreate) {
      setRoute({
        id: "new" as any,
        route_name: "",
        name: "",
        frequency: "",
        pickup: null,
        destination: null,
        pickup_time: "",
        approx_duration_mins: null,
        approximate_distance_miles: null,
        journey_type_id: "",
      });
      setAssignments([]);
      setLoading(false);
      return;
    }
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      const [r, a] = await Promise.all([
        sb
          .from("routes")
          .select(
            `
            id, route_name, name, frequency, pickup_time, approx_duration_mins, approximate_distance_miles, journey_type_id,
            pickup:pickup_id ( id, name, picture_url ),
            destination:destination_id ( id, name, picture_url )
          `
          )
          .eq("id", params.id)
          .single(),
        sb.from("route_vehicle_assignments").select("route_id,vehicle_id,is_active,preferred").eq("is_active", true),
      ]);
      if (off) return;

      if (r.error || !r.data) {
        setMsg(r.error?.message ?? "Route not found.");
      } else {
        const row = r.data as any;
        setRoute({
          id: row.id,
          route_name: row.route_name ?? "",
          name: row.name ?? "",
          frequency: row.frequency ?? "",
          pickup_time: row.pickup_time ?? "",
          approx_duration_mins: row.approx_duration_mins ?? null,
          approximate_distance_miles: row.approximate_distance_miles ?? null,
          journey_type_id: row.journey_type_id ?? "",
          pickup: row.pickup ? { id: row.pickup.id, name: row.pickup.name, picture_url: row.pickup.picture_url } : null,
          destination: row.destination
            ? { id: row.destination.id, name: row.destination.name, picture_url: row.destination.picture_url }
            : null,
        });
      }
      if (a.data) setAssignments((a.data as Assignment[]) || []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [params.id, isCreate]);

  // load vehicles for the operator (NO journey_type_id column)
  useEffect(() => {
    if (!sb || !operatorId || isCreate) return;
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
  }, [operatorId, isCreate]);

  const assignedForThisRoute = useMemo(() => {
    if (isCreate) return [];
    const ids = new Set(vehicles.map((v) => v.id));
    return assignments.filter((a) => a.route_id === params.id && ids.has(a.vehicle_id));
  }, [assignments, vehicles, params.id, isCreate]);

  const preferred = assignedForThisRoute.find((a) => a.preferred);
  const assignedIds = new Set(assignedForThisRoute.map((a) => a.vehicle_id));

  const opAllowedTypes = useMemo(() => {
    if (!operatorId) return new Set<string>();
    return new Set(opTypeRels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id));
  }, [opTypeRels, operatorId]);

  // With no vehicle-level type, enforce by operator permission + route type
  function isAssignmentAllowed(): boolean {
    if (!route?.journey_type_id) return false;
    if (!operatorId) return false;
    return opAllowedTypes.has(route.journey_type_id);
  }

  async function reloadAssignments() {
    if (isCreate) return;
    const { data, error } = await sb!
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("is_active", true);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(routeId: string, vehicleId: string, currentlyAssigned: boolean) {
    if (isCreate) return;
    try {
      if (!currentlyAssigned && !isAssignmentAllowed()) {
        alert("Transport type for this route isn’t allowed for the selected operator.");
        return;
      }
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
          .upsert({ route_id: routeId, vehicle_id: vehicleId, is_active: true, preferred: false }, { onConflict: "route_id,vehicle_id" });
        if (error) throw error;
      }
      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to update");
    }
  }

  async function setPreferred(routeId: string, vehicleId: string) {
    if (isCreate) return;
    try {
      if (!isAssignmentAllowed()) {
        alert("Preferred vehicle assignment blocked by transport type policy.");
        return;
      }
      const { error: clearErr } = await sb!
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", routeId)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      const { error: upErr } = await sb!
        .from("route_vehicle_assignments")
        .upsert({ route_id: routeId, vehicle_id: vehicleId, is_active: true, preferred: true }, { onConflict: "route_id,vehicle_id" });
      if (upErr) throw upErr;

      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to set preferred");
    }
  }

  async function saveRouteJourneyType(journeyTypeId: string) {
    if (!sb || !route?.id || isCreate) return;
    try {
      setSavingJT(true);
      const { error } = await sb.from("routes").update({ journey_type_id: journeyTypeId || null }).eq("id", route.id);
      if (error) throw error;
      setRoute((r) => (r ? { ...r, journey_type_id: journeyTypeId || null } : r));
    } catch (e: any) {
      alert(e.message ?? "Unable to save transport type.");
    } finally {
      setSavingJT(false);
    }
  }

  // Minimal core fields editor (works for edit + create)
  async function saveCore() {
    if (!sb) return;
    try {
      setSavingCore(true);

      const payload: any = {
        route_name: route?.route_name || null,
        name: route?.name || null,
        frequency: route?.frequency || null,
        pickup_time: route?.pickup_time || null,
        approx_duration_mins: route?.approx_duration_mins ?? null,
        approximate_distance_miles: route?.approximate_distance_miles ?? null,
        journey_type_id: route?.journey_type_id || null,
      };
      if (route?.pickup?.id) payload.pickup_id = route.pickup.id;
      if (route?.destination?.id) payload.destination_id = route.destination.id;

      if (isCreate) {
        // basic create; assumes routes doesn’t require operator_id (association is via assignments)
        const { data, error } = await sb.from("routes").insert({ ...payload, is_active: true }).select("id").single();
        if (error) throw error;
        router.push(`/operator-admin/routes/edit/${data.id}?op=${encodeURIComponent(operatorId)}`);
      } else {
        const { error } = await sb.from("routes").update(payload).eq("id", route!.id);
        if (error) throw error;
        setMsg("Saved.");
        setTimeout(() => setMsg(null), 1200);
      }
    } catch (e: any) {
      alert(e.message ?? "Unable to save.");
    } finally {
      setSavingCore(false);
    }
  }

  function setField<K extends keyof RouteRow>(key: K, val: RouteRow[K]) {
    setRoute((r) => (r ? { ...r, [key]: val } : r));
  }

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <button className="rounded-full border px-3 py-1.5 text-sm" onClick={() => router.push("/operator-admin/routes")}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {isCreate ? "New Route" : route ? `${route.pickup?.name ?? "—"} → ${route.destination?.name ?? "—"}` : "Route"}
        </h1>
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {/* Core editor (works for create + edit) */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-neutral-600 mb-1">Route name (internal)</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={route?.route_name || ""}
              onChange={(e) => setField("route_name", e.target.value)}
            />
          </div>
          <div>
            <div className="text-xs text-neutral-600 mb-1">Display name</div>
            <input className="w-full border rounded px-3 py-2" value={route?.name || ""} onChange={(e) => setField("name", e.target.value)} />
          </div>
          <div>
            <div className="text-xs text-neutral-600 mb-1">Frequency</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={route?.frequency || ""}
              onChange={(e) => setField("frequency", e.target.value)}
            />
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Pickup</div>
            <select
              className="w-full border rounded px-3 py-2"
              value={route?.pickup?.id || ""}
              onChange={(e) => {
                const d = destinations.find((x) => x.id === e.target.value) || null;
                setField("pickup", d ? { id: d.id, name: d.name, picture_url: d.picture_url } : null);
              }}
            >
              <option value="">— Select —</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Destination</div>
            <select
              className="w-full border rounded px-3 py-2"
              value={route?.destination?.id || ""}
              onChange={(e) => {
                const d = destinations.find((x) => x.id === e.target.value) || null;
                setField("destination", d ? { id: d.id, name: d.name, picture_url: d.picture_url } : null);
              }}
            >
              <option value="">— Select —</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Pickup time (local)</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={route?.pickup_time || ""}
              onChange={(e) => setField("pickup_time", e.target.value)}
              placeholder="e.g. 13:30"
            />
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Duration (mins)</div>
            <input
              className="w-full border rounded px-3 py-2"
              type="number"
              value={route?.approx_duration_mins ?? ""}
              onChange={(e) => setField("approx_duration_mins", e.target.value ? Number(e.target.value) : null)}
            />
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Distance (miles)</div>
            <input
              className="w-full border rounded px-3 py-2"
              type="number"
              value={route?.approximate_distance_miles ?? ""}
              onChange={(e) => setField("approximate_distance_miles", e.target.value ? Number(e.target.value) : null)}
            />
          </div>

          <div>
            <div className="text-xs text-neutral-600 mb-1">Transport type</div>
            <select
              className="w-full border rounded px-3 py-2"
              value={route?.journey_type_id || ""}
              onChange={(e) => (!isCreate ? saveRouteJourneyType(e.target.value) : setField("journey_type_id", e.target.value))}
            >
              <option value="">— Not set —</option>
              {journeyTypes.map((jt) => (
                <option key={jt.id} value={jt.id}>
                  {jt.name}
                </option>
              ))}
            </select>
            {!isCreate && savingJT && <div className="text-xs text-neutral-500 mt-1">Saving…</div>}
          </div>
        </div>

        <div>
          <button
            className="rounded-full px-4 py-2 bg-blue-600 text-white disabled:opacity-60"
            onClick={saveCore}
            disabled={savingCore}
          >
            {isCreate ? "Create route" : "Save changes"}
          </button>
        </div>
      </section>

      {/* Read-only hero block stays as-is */}
      {!isCreate && (
        <section className="rounded-2xl border bg-white shadow overflow-hidden">
          <div className="grid grid-cols-2 gap-0">
            <div className="relative aspect-[16/7]">
              {publicImage(route?.pickup?.picture_url) ? (
                <Image src={publicImage(route?.pickup?.picture_url)!} alt={route?.pickup?.name || "Pickup"} fill unoptimized className="object-cover" />
              ) : (
                <div className="absolute inset-0 bg-neutral-100" />
              )}
            </div>
            <div className="relative aspect-[16/7]">
              {publicImage(route?.destination?.picture_url) ? (
                <Image src={publicImage(route?.destination?.picture_url)!} alt={route?.destination?.name || "Destination"} fill unoptimized className="object-cover" />
              ) : (
                <div className="absolute inset-0 bg-neutral-100" />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Vehicle assignment section */}
      {!isCreate && (
        <section className="rounded-2xl border bg-white shadow p-4 space-y-4">
          {!operatorId ? (
            <div className="text-sm text-neutral-500">
              No operator selected. Open this page from the routes list (which sets the operator context).
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-sm text-neutral-500">No active vehicles for this operator.</div>
          ) : (
            <>
              {!isAssignmentAllowed() && (
                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  This operator isn’t permitted to run the selected transport type. Choose another type above, or pick a different operator.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {vehicles.map((v) => {
                  const assigned = assignedIds.has(v.id);
                  const isPref = preferred?.vehicle_id === v.id;
                  const allowed = isAssignmentAllowed();

                  return (
                    <div
                      key={v.id}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                        assigned ? "bg-black text-white border-black" : "bg-white"
                      } ${!allowed ? "opacity-50" : ""}`}
                      title={allowed ? "" : "Transport type not permitted for this operator."}
                    >
                      <button
                        className="outline-none disabled:opacity-60"
                        title={assigned ? "Unassign" : "Assign to route"}
                        onClick={() => toggleAssign(params.id, v.id, assigned)}
                        disabled={!allowed}
                      >
                        {v.name} ({v.minseats}–{v.maxseats})
                      </button>
                      <button
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          isPref ? "bg-yellow-400 text-black border-yellow-500" : "bg-white text-black border-neutral-300"
                        }`}
                        title="Mark as preferred"
                        onClick={() => setPreferred(params.id, v.id)}
                        disabled={!allowed}
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
      )}
    </div>
  );
}
