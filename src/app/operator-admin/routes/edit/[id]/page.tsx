"use client";

import Image from "next/image";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Same publicImage helper you use on Destinations ---------- */
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

/* ---------- Types ---------- */
type UUID = string;

type PsUser = {
  id: UUID;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: UUID; name: string };

type Vehicle = {
  id: UUID;
  name: string;
  minseats: number | string;
  maxseats: number | string;
  active: boolean | null;
  operator_id: string | null;
  type_id: string | null; // journey_types.id
};

type Assignment = {
  route_id: string;
  vehicle_id: string;
  is_active: boolean;
  preferred: boolean;
};

type OpTypeRel = { operator_id: string; journey_type_id: string };

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
  // (We omit optional timing columns to avoid 400s if they don't exist)
};

export default function OperatorRouteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const opFromQuery = search.get("op") || "";

  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>(""); // vehicle assignment context
  const [route, setRoute] = useState<RouteRow | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OpTypeRel[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ps_user + operator lock (query param wins)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (opFromQuery) setOperatorId(opFromQuery);
      else if (u?.operator_admin && u.operator_id) setOperatorId(u.operator_id);
    } catch {
      setPsUser(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lookups + route (only safe columns -> no 400 in console)
  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) return;
      setLoading(true);
      setMsg(null);

      const [ops, r, rels] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb
          .from("routes")
          .select(
            `
            id,
            route_name,
            name,
            frequency,
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `
          )
          .eq("id", params.id)
          .single(),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (rels.data) setOpTypeRels((rels.data as OpTypeRel[]) || []);

      if (r.data) {
        const row = r.data as any;
        const routeRow: RouteRow = {
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup: row.pickup
            ? { name: row.pickup.name as string, picture_url: row.pickup.picture_url as string | null }
            : null,
          destination: row.destination
            ? { name: row.destination.name as string, picture_url: row.destination.picture_url as string | null }
            : null,
        };
        setRoute(routeRow);
      } else if (r.error) {
        setMsg(r.error.message);
      }

      // Only pull assignments for this route
      const asn = await sb
        .from("route_vehicle_assignments")
        .select("route_id,vehicle_id,is_active,preferred")
        .eq("route_id", params.id)
        .eq("is_active", true);
      if (!off && asn.data) setAssignments((asn.data as Assignment[]) || []);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [params.id]);

  // Load vehicles for the selected operator
  useEffect(() => {
    if (!sb || !operatorId) return;
    let off = false;
    (async () => {
      setMsg(null);
      const { data, error } = await sb
        .from("vehicles")
        .select("id,name,minseats,maxseats,active,operator_id,type_id")
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

  // Allowed journey types for the selected operator
  const allowedTypeIds = useMemo(() => {
    if (!operatorId) return new Set<string>();
    return new Set(opTypeRels.filter(r => r.operator_id === operatorId).map(r => r.journey_type_id));
  }, [opTypeRels, operatorId]);

  // Filter vehicles so operator can only assign within their allowed journey types
  const vehiclesFiltered = useMemo(
    () => vehicles.filter(v => !v.type_id || allowedTypeIds.has(v.type_id)),
    [vehicles, allowedTypeIds]
  );

  const preferred = assignments.find((a) => a.preferred);
  const assignedIds = new Set(assignments.map((a) => a.vehicle_id));

  async function reloadAssignments() {
    const { data, error } = await sb!
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", params.id)
      .eq("is_active", true);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(vehicleId: string, currentlyAssigned: boolean) {
    try {
      if (currentlyAssigned) {
        const { error } = await sb!
          .from("route_vehicle_assignments")
          .update({ is_active: false, preferred: false })
          .eq("route_id", params.id)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await sb!
          .from("route_vehicle_assignments")
          .upsert(
            { route_id: params.id, vehicle_id: vehicleId, is_active: true, preferred: false },
            { onConflict: "route_id,vehicle_id" }
          );
        if (error) throw error;
      }
      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to update");
    }
  }

  async function setPreferred(vehicleId: string) {
    try {
      const { error: clearErr } = await sb!
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", params.id)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      const { error: upErr } = await sb!
        .from("route_vehicle_assignments")
        .upsert(
          { route_id: params.id, vehicle_id: vehicleId, is_active: true, preferred: true },
          { onConflict: "route_id,vehicle_id" }
        );
      if (upErr) throw upErr;

      await reloadAssignments();
    } catch (e: any) {
      alert(e.message ?? "Unable to set preferred");
    }
  }

  const isOpAdmin = Boolean(psUser?.operator_admin && psUser.operator_id);
  const lockedOperatorName =
    isOpAdmin && psUser?.operator_id
      ? psUser?.operator_name ||
        operators.find((o) => o.id === psUser.operator_id)?.name ||
        psUser.operator_id
      : "";

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <button
          className="rounded-full border px-3 py-1.5 text-sm"
          onClick={() => router.push("/operator-admin/routes")}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {route ? `${route.pickup?.name ?? "—"} → ${route.destination?.name ?? "—"}` : "Route"}
        </h1>
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {/* Images + basic facts (frequency only since other fields are not guaranteed) */}
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
            <div className="font-medium">—</div>
          </div>
          <div>
            <div className="text-neutral-500">Duration</div>
            <div className="font-medium">—</div>
          </div>
          <div>
            <div className="text-neutral-500">Distance</div>
            <div className="font-medium">—</div>
          </div>
        </div>
      </section>

      {/* Operator context + filtered vehicle assignment */}
      <section className="rounded-2xl border bg-white shadow p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-neutral-600">Operator</div>
          {isOpAdmin ? (
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {lockedOperatorName || psUser?.operator_id}
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

        {!operatorId ? (
          <div className="text-sm text-neutral-500">Choose an Operator to assign vehicles.</div>
        ) : vehiclesFiltered.length === 0 ? (
          <div className="text-sm text-neutral-500">No active vehicles for this operator (or none for the allowed journey types).</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {vehiclesFiltered.map((v) => {
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
                      onClick={() => toggleAssign(v.id, assigned)}
                    >
                      {v.name} ({v.minseats}–{v.maxseats})
                    </button>
                    <button
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        isPref ? "bg-yellow-400 text-black border-yellow-500" : "bg-white text-black border-neutral-300"
                      }`}
                      title="Mark as preferred"
                      onClick={() => setPreferred(v.id)}
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
                {preferred ? vehiclesFiltered.find((v) => v.id === preferred.vehicle_id)?.name ?? "—" : "—"}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
