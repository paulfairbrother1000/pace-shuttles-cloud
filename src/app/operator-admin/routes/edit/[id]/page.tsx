"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ───────────── Supabase ───────────── */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ───────────── Types ───────────── */
type PsUser = { id: string; operator_admin?: boolean | null; operator_id?: string | null; operator_name?: string | null };
type Operator = { id: string; name: string };
type Vehicle = { id: string; name: string; minseats: number; maxseats: number; active: boolean | null; operator_id: string | null; };
type Assignment = { route_id: string; vehicle_id: string; is_active: boolean; preferred: boolean };

type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  pickup: { id: string; name: string; picture_url: string | null } | null;
  destination: { id: string; name: string; picture_url: string | null } | null;
};

/* ───────────── Helpers ───────────── */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* ───────────── Page ───────────── */
export default function OperatorRouteEditPage() {
  const { id } = useParams<{ id: string }>();

  /* ps_user lock */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* state */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState(""); // only used for site admin to change operator context
  const [row, setRow] = useState<RouteRow | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [thumbs, setThumbs] = useState<{ pu: string | null; de: string | null }>({ pu: null, de: null });
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* lookups + route */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

      const [ops, r] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb
          .from("routes")
          .select(`
            id, route_name, name, frequency, pickup_time,
            approx_duration_mins, approximate_distance_miles,
            pickup:pickup_id ( id, name, picture_url ),
            destination:destination_id ( id, name, picture_url )
          `)
          .eq("id", id)
          .single(),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.data) {
        const row = r.data as any;
        const mapped: RouteRow = {
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup_time: row.pickup_time ?? null,
          approx_duration_mins: row.approx_duration_mins ?? null,
          approximate_distance_miles: row.approximate_distance_miles ?? null,
          pickup: row.pickup ? { id: row.pickup.id, name: row.pickup.name, picture_url: row.pickup.picture_url } : null,
          destination: row.destination ? { id: row.destination.id, name: row.destination.name, picture_url: row.destination.picture_url } : null,
        };
        setRow(mapped);

        const pu = await resolveStorageUrl(mapped.pickup?.picture_url ?? null);
        const de = await resolveStorageUrl(mapped.destination?.picture_url ?? null);
        setThumbs({ pu, de });
      } else if (r.error) {
        setMsg(r.error.message);
      }

      setLoading(false);
    })();
    return () => { off = true; };
  }, [id]);

  /* operator context (vehicles + assignments) */
  useEffect(() => {
    const ctx = operatorLocked ? (psUser?.operator_id || "") : operatorId;
    if (!ctx) return;

    let off = false;
    (async () => {
      const [vs, asn] = await Promise.all([
        sb.from("vehicles")
          .select("id,name,minseats,maxseats,active,operator_id")
          .eq("operator_id", ctx)
          .eq("active", true)
          .order("name"),
        sb.from("route_vehicle_assignments").select("route_id,vehicle_id,is_active,preferred").eq("route_id", id),
      ]);
      if (off) return;

      if (vs.data) setVehicles((vs.data as Vehicle[]) || []);
      if (asn.data) setAssignments((asn.data as Assignment[]) || []);
    })();

    return () => { off = true; };
  }, [operatorLocked, operatorId, psUser?.operator_id, id]);

  /* assignment helpers */
  const assignedIds = useMemo(
    () => new Set(assignments.filter(a => a.is_active).map(a => a.vehicle_id)),
    [assignments]
  );
  const preferredId = useMemo(
    () => assignments.find(a => a.preferred)?.vehicle_id ?? null,
    [assignments]
  );

  async function reloadAssignments(ctxOperatorId: string) {
    const { data } = await sb
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", id);
    setAssignments((data as Assignment[]) || []);
  }

  async function toggleAssign(vehicleId: string, isAssigned: boolean) {
    try {
      if (isAssigned) {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .update({ is_active: false, preferred: false })
          .eq("route_id", id)
          .eq("vehicle_id", vehicleId);
        if (error) throw error;
      } else {
        const { error } = await sb
          .from("route_vehicle_assignments")
          .upsert(
            { route_id: id, vehicle_id: vehicleId, is_active: true, preferred: false },
            { onConflict: "route_id,vehicle_id" }
          );
        if (error) throw error;
      }
      await reloadAssignments(operatorLocked ? (psUser?.operator_id || "") : operatorId);
    } catch (e: any) {
      alert(e.message ?? "Unable to update");
    }
  }

  async function setPreferred(vehicleId: string) {
    try {
      const { error: clearErr } = await sb
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", id)
        .eq("preferred", true);
      if (clearErr) throw clearErr;

      const { error: upErr } = await sb
        .from("route_vehicle_assignments")
        .upsert(
          { route_id: id, vehicle_id: vehicleId, is_active: true, preferred: true },
          { onConflict: "route_id,vehicle_id" }
        );
      if (upErr) throw upErr;

      await reloadAssignments(operatorLocked ? (psUser?.operator_id || "") : operatorId);
    } catch (e: any) {
      alert(e.message ?? "Unable to set preferred");
    }
  }

  const lockedName =
    operatorLocked &&
    (psUser?.operator_name || operators.find(o => o.id === psUser?.operator_id)?.name || psUser?.operator_id);

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/operator-admin/routes" className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm">
          ← Back
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{row?.route_name || row?.name || "Route"}</h1>
        {row && (
          <p className="text-neutral-600">
            {row.pickup?.name ?? "—"} → {row.destination?.name ?? "—"}
          </p>
        )}
      </header>

      {/* Collage hero */}
      <section className="rounded-2xl border bg-white shadow overflow-hidden">
        <div className="w-full aspect-[16/9] grid grid-cols-2">
          <div className="relative">
            {thumbs.pu ? (
              <img
                src={thumbs.pu}
                alt={row?.pickup?.name || "pickup"}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: "50% 40%" }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-neutral-400 bg-neutral-100">No image</div>
            )}
          </div>
          <div className="relative border-l">
            {thumbs.de ? (
              <img
                src={thumbs.de}
                alt={row?.destination?.name || "destination"}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: "50% 40%" }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-neutral-400 bg-neutral-100">No image</div>
            )}
          </div>
        </div>

        {/* facts */}
        <div className="p-4 grid sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-neutral-500">Frequency</div>
            <div className="font-medium">{row?.frequency || "—"}</div>
          </div>
          <div>
            <div className="text-neutral-500">Pickup time (local)</div>
            <div className="font-medium">{row?.pickup_time || "—"}</div>
          </div>
          <div className="flex gap-6">
            <div>
              <div className="text-neutral-500">Duration</div>
              <div className="font-medium">{row?.approx_duration_mins ?? "—"} mins</div>
            </div>
            <div>
              <div className="text-neutral-500">Distance</div>
              <div className="font-medium">{row?.approximate_distance_miles ?? "—"} mi</div>
            </div>
          </div>
        </div>
      </section>

      {/* Operator context */}
      <section className="rounded-2xl border bg-white p-4 shadow space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-600">Operator</span>
          {operatorLocked ? (
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {lockedName}
            </span>
          ) : (
            <select
              className="border rounded-lg px-3 py-2"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="">— Select —</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {msg && <span className="ml-auto text-sm text-neutral-600">{msg}</span>}
        </div>

        {/* Assignment controls */}
        {!operatorLocked && !operatorId ? (
          <div className="text-sm text-neutral-500">Choose an operator to manage assignments.</div>
        ) : vehicles.length === 0 ? (
          <div className="text-sm text-neutral-500">No active vehicles for this operator.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {vehicles.map((v) => {
              const assigned = assignedIds.has(v.id);
              const isPref = preferredId === v.id;
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
        )}
      </section>
    </div>
  );
}
