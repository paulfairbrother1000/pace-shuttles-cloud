// src/app/operator-admin/route-editor/[id]/page.tsx
"use client";

export const dynamic = "force-dynamic";

export const fetchCache = "force-no-store";
export const dynamicParams = true;

import Image from "next/image";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

/* --- Supabase (client) --- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* --- Types --- */
type UUID = string;
type PsUser = {
  id: UUID;
  site_admin?: boolean | null;
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
type Assignment = { route_id: string; vehicle_id: string; is_active: boolean; preferred: boolean };
type RouteRow = {
  id: UUID | "new";
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
type Destination = { id: string; name: string; picture_url: string | null };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function AdminRouteEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  const id = params.id;
  const isCreate = id === "new";
  const looksLikeUuid = UUID_RE.test(id);
  const opFromQuery = search.get("op") || "";

  if (typeof window === "undefined" && isCreate) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2">
          <div className="rounded-full border px-3 py-1.5 text-sm opacity-60">← Back</div>
          <h1 className="text-2xl font-semibold">New Route</h1>
        </div>
      </div>
    );
  }

  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operatorId, setOperatorId] = useState<string>("");

  const [route, setRoute] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);
  const [rels, setRels] = useState<OperatorTypeRel[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isSiteAdmin = Boolean(psUser?.site_admin);
  const isReadOnly = !isSiteAdmin;

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

  useEffect(() => {
    if (!sb) return;
    (async () => {
      const [tQ, relQ, dQ] = await Promise.all([
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb.from("destinations").select("id,name,picture_url").order("name"),
      ]);
      setTypes((tQ.data || []) as JourneyType[]);
      setRels((relQ.data || []) as OperatorTypeRel[]);
      setDestinations((dQ.data || []) as Destination[]);
    })();
  }, []);

  useEffect(() => {
    if (!sb) return;

    if (isCreate || !looksLikeUuid) {
      setRoute({
        id: "new",
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
      setVehicles([]);
      return;
    }

    let off = false;
    (async () => {
      setMsg(null);
      const [rQ, aQ] = await Promise.all([
        sb
          .from("routes")
          .select(`
            id, route_name, name, frequency, pickup_time, approx_duration_mins, approximate_distance_miles, journey_type_id,
            pickup:pickup_id ( id, name, picture_url ),
            destination:destination_id ( id, name, picture_url )
          `)
          .eq("id", id)
          .single(),
        sb
          .from("route_vehicle_assignments")
          .select("route_id,vehicle_id,is_active,preferred")
          .eq("is_active", true),
      ]);

      if (off) return;

      if (rQ.error || !rQ.data) setMsg(rQ.error?.message ?? "Route not found.");
      else {
        const row = rQ.data as any;
        setRoute({
          id: row.id,
          route_name: row.route_name ?? "",
          name: row.name ?? "",
          frequency: row.frequency ?? "",
          pickup_time: row.pickup_time ?? "",
          approx_duration_mins: row.approx_duration_mins ?? null,
          approximate_distance_miles: row.approximate_distance_miles ?? null,
          journey_type_id: row.journey_type_id ?? "",
          pickup: row.pickup
            ? { id: row.pickup.id, name: row.pickup.name, picture_url: row.pickup.picture_url }
            : null,
          destination: row.destination
            ? { id: row.destination.id, name: row.destination.name, picture_url: row.destination.picture_url }
            : null,
        });
      }
      if (aQ.data) setAssignments((aQ.data as Assignment[]) || []);
    })();

    return () => {
      off = true;
    };
  }, [id, isCreate, looksLikeUuid]);

  useEffect(() => {
    if (!sb || !operatorId || isCreate || !looksLikeUuid) return;
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
  }, [operatorId, isCreate, looksLikeUuid]);

  const assignedForThisRoute = useMemo(() => {
    if (isCreate || !looksLikeUuid) return [];
    const ids = new Set(vehicles.map((v) => v.id));
    return assignments.filter((a) => a.route_id === id && ids.has(a.vehicle_id));
  }, [assignments, vehicles, id, isCreate, looksLikeUuid]);

  const preferred = assignedForThisRoute.find((a) => a.preferred);
  const assignedIds = new Set(assignedForThisRoute.map((a) => a.vehicle_id));

  const opAllowedTypes = useMemo(() => {
    if (!operatorId) return new Set<string>();
    return new Set(rels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id));
  }, [rels, operatorId]);

  const assignmentAllowed = Boolean(route?.journey_type_id && opAllowedTypes.has(route.journey_type_id!));

  function setField<K extends keyof RouteRow>(key: K, val: RouteRow[K]) {
    if (!isSiteAdmin) return;
    setRoute((r) => (r ? { ...r, [key]: val } : r));
  }

  async function reloadAssignments() {
    if (isCreate || !looksLikeUuid) return;
    const { data, error } = await sb!
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("is_active", true);
    if (!error) setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(routeId: string, vehicleId: string, currentlyAssigned: boolean) {
    if (isCreate || !looksLikeUuid || !isSiteAdmin) return;
    try {
      if (!currentlyAssigned && !assignmentAllowed) {
        alert("This operator isn’t permitted to run the selected transport type.");
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
    if (isCreate || !looksLikeUuid || !isSiteAdmin) return;
    try {
      if (!assignmentAllowed) {
        alert("Preferred vehicle blocked by transport type policy.");
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

  async function saveCore() {
    if (!sb || !route || !isSiteAdmin) return;
    try {
      setSaving(true);
      const payload: any = {
        route_name: route.route_name || null,
        name: route.name || null,
        frequency: route.frequency || null,
        pickup_time: route.pickup_time || null,
        approx_duration_mins: route.approx_duration_mins ?? null,
        approximate_distance_miles: route.approximate_distance_miles ?? null,
        journey_type_id: route.journey_type_id || null,
        is_active: true,
      };
      if (route.pickup?.id) payload.pickup_id = route.pickup.id;
      if (route.destination?.id) payload.destination_id = route.destination.id;

      if (isCreate || !looksLikeUuid) {
        const { data, error } = await sb.from("routes").insert(payload).select("id").single();
        if (error) throw error;

        // NOTE: new path here
        router.replace(
          `/operator-admin/route-editor/${data!.id}${operatorId ? `?op=${encodeURIComponent(operatorId)}` : ""}`
        );
      } else {
        const { error } = await sb.from("routes").update(payload).eq("id", route.id as string);
        if (error) throw error;
      }
    } catch (e: any) {
      alert(e.message ?? "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

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
          {isCreate
            ? "New Route"
            : route
            ? `${route.pickup?.name ?? "—"} → ${route.destination?.name ?? "—"}`
            : "Route"}
        </h1>
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {/* …KEEP THE REST OF YOUR EDITOR UI AS YOU HAVE IT… */}
      {/* (Form fields, pictures, assignment chips, Save button, etc.) */}

      {/* For brevity I’m not duplicating every line again. Paste your existing body here unchanged. */}
    </div>
  );
}
