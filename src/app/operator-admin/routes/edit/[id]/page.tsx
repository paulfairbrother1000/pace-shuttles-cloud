"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
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
  site_admin?: boolean | null;
};

type Operator = { id: string; name: string };

type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup_time_local?: string | null;
  duration_mins?: number | null;
  distance_miles?: number | null;
  pickup?: { name: string; picture_url?: string | null } | null;
  destination?: { name: string; picture_url?: string | null } | null;
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

/** Resolve a storage path or raw URL to a browser-loadable URL.
 *  We try public URL first (works for public buckets), then fall back to a long-lived signed URL.
 */
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;

  // Public URL (works if bucket/object is public)
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;

  // Signed fallback (works for private)
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/* ===================================================================== */

export default function OperatorRouteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  /* ps_user (lock operator if operator_admin) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);
  const operatorLocked = Boolean(psUser?.operator_admin && psUser?.operator_id);

  /* Operator context (site admin may pass ?op=<operator_id> from the tiles page) */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>("");

  // Initialize operatorId once from (lock || query param)
  useEffect(() => {
    if (operatorLocked && psUser?.operator_id) {
      setOperatorId(psUser.operator_id);
    } else {
      const qop = search.get("op") || "";
      setOperatorId(qop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorLocked, psUser?.operator_id]);

  /* Data */
  const [route, setRoute] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Resolved pictures */
  const [pickupImg, setPickupImg] = useState<string | null>(null);
  const [destImg, setDestImg] = useState<string | null>(null);

  /* Load lookups + route core (single row) */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);

      const [ops, r] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb
          .from("routes")
          .select(
            `
            id,
            route_name,
            name,
            frequency,
            pickup_time_local,
            duration_mins,
            distance_miles,
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `
          )
          .eq("id", params.id)
          .maybeSingle(),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.error) {
        setMsg(r.error.message);
        setRoute(null);
      } else {
        const row = r.data as any;
        const mapped: RouteRow | null = row
          ? {
              id: row.id,
              route_name: row.route_name ?? null,
              name: row.name ?? null,
              frequency: row.frequency ?? null,
              pickup_time_local: row.pickup_time_local ?? null,
              duration_mins: row.duration_mins ?? null,
              distance_miles: row.distance_miles ?? null,
              pickup: row.pickup
                ? { name: row.pickup.name as string, picture_url: row.pickup.picture_url ?? null }
                : null,
              destination: row.destination
                ? {
                    name: row.destination.name as string,
                    picture_url: row.destination.picture_url ?? null,
                  }
                : null,
            }
          : null;

        setRoute(mapped);

        // Resolve pictures (public or signed)
        const [p, d] = await Promise.all([
          resolveStorageUrl(mapped?.pickup?.picture_url || null),
          resolveStorageUrl(mapped?.destination?.picture_url || null),
        ]);
        setPickupImg(p);
        setDestImg(d);
      }

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [params.id]);

  /* Load vehicles for the selected operator + all assignments (we’ll filter by operator vehicles) */
  useEffect(() => {
    if (!operatorId) return;
    let off = false;
    (async () => {
      setMsg(null);

      const [vs, asn] = await Promise.all([
        sb
          .from("vehicles")
          .select("id,name,minseats,maxseats,active,operator_id")
          .eq("operator_id", operatorId)
          .eq("active", true)
          .order("name"),
        sb
          .from("route_vehicle_assignments")
          .select("route_id,vehicle_id,is_active,preferred")
          .eq("route_id", params.id),
      ]);

      if (off) return;

      if (vs.error) setMsg(vs.error.message);
      setVehicles((vs.data as Vehicle[]) || []);

      if (!asn.error && asn.data) setAssignments((asn.data as Assignment[]) || []);
    })();
    return () => {
      off = true;
    };
  }, [operatorId, params.id]);

  /* Filter assignments to just vehicles that belong to current operator */
  const assignedVehicleIds = useMemo(() => {
    const allowed = new Set(vehicles.map((v) => v.id));
    return new Set(assignments.filter((a) => allowed.has(a.vehicle_id) && a.is_active).map((a) => a.vehicle_id));
  }, [assignments, vehicles]);

  const preferredVehicleId = useMemo(
    () =>
      assignments.find((a) => a.is_active && a.preferred && vehicles.some((v) => v.id === a.vehicle_id))
        ?.vehicle_id || null,
    [assignments, vehicles]
  );

  /* Actions */
  async function reloadAssignments() {
    const { data, error } = await sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", params.id);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(vehicleId: string, currentlyAssigned: boolean) {
    try {
      if (currentlyAssigned) {
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
      alert(e.message ?? "Unable to update assignment");
    }
  }

  async function setPreferred(vehicleId: string) {
    try {
      // clear existing for this route
      const { error: clearErr } = await sb
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", params.id)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      // ensure this vehicle is assigned & preferred
      const { error: upErr } = await sb
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
      if (upErr) throw upErr;

      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to set preferred");
    }
  }

  /* Derived / display helpers */
  const lockedOperatorName =
    operatorLocked && psUser?.operator_id
      ? psUser.operator_name ||
        operators.find((o) => o.id === psUser.operator_id)?.name ||
        psUser.operator_id
      : "";

  const title =
    route?.route_name ||
    (route?.pickup?.name && route?.destination?.name
      ? `${route.pickup.name} → ${route.destination.name}`
      : route?.name || "Route");

  return (
    <div className="p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          className="rounded-full border px-3 py-1.5 text-sm"
          onClick={() => {
            // send operator back to tiles (retain operator id if any)
            const op = operatorLocked ? psUser?.operator_id : operatorId;
            router.push(op ? `/operator-admin/routes?op=${op}` : "/operator-admin/routes");
          }}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {/* Route images + meta */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-4">
        {/* Two images side-by-side on desktop; stacked on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl overflow-hidden border bg-neutral-50 aspect-[16/10] grid place-items-center">
            {pickupImg ? (
              <img src={pickupImg} alt={route?.pickup?.name || "Pickup"} className="h-full w-full object-cover" />
            ) : (
              <span className="text-neutral-400 text-sm">{route?.pickup?.name || "Pick-up"}</span>
            )}
          </div>
          <div className="rounded-xl overflow-hidden border bg-neutral-50 aspect-[16/10] grid place-items-center">
            {destImg ? (
              <img
                src={destImg}
                alt={route?.destination?.name || "Destination"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-neutral-400 text-sm">{route?.destination?.name || "Destination"}</span>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-neutral-500">Frequency</div>
            <div className="font-medium">{route?.frequency || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Pickup time (local)</div>
            <div className="font-medium">{route?.pickup_time_local || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Duration</div>
            <div className="font-medium">
              {route?.duration_mins != null ? `${route.duration_mins} mins` : "—"}
            </div>
          </div>
          <div>
            <div className="text-neutral-500">Distance</div>
            <div className="font-medium">
              {route?.distance_miles != null ? `${route.distance_miles} mi` : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Operator + vehicle assignments */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-neutral-600">Operator</div>

          {operatorLocked ? (
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {lockedOperatorName}
            </div>
          ) : (
            <select
              className="border rounded-full px-3 py-2"
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
        </div>

        {/* Chips */}
        {operatorId ? (
          <div className="flex flex-wrap gap-2">
            {vehicles.length === 0 ? (
              <span className="text-sm text-neutral-500">No active vehicles for this operator.</span>
            ) : (
              vehicles.map((v) => {
                const assigned = assignedVehicleIds.has(v.id);
                const isPref = preferredVehicleId === v.id;
                return (
                  <div
                    key={v.id}
                    className={cls(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
                      assigned ? "bg-black text-white border-black" : "bg-white"
                    )}
                  >
                    <button
                      className="outline-none"
                      title={assigned ? "Unassign from route" : "Assign to route"}
                      onClick={() => toggleAssign(v.id, assigned)}
                    >
                      {v.name} ({v.minseats}–{v.maxseats})
                    </button>
                    <button
                      className={cls(
                        "rounded-full border px-2 py-0.5 text-xs",
                        isPref ? "bg-yellow-400 text-black border-yellow-500" : "bg-white text-black border-neutral-300"
                      )}
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
        ) : (
          <div className="text-sm text-neutral-500">Select an operator to manage assignments.</div>
        )}
      </section>
    </div>
  );
}
