"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ───────────── Supabase ───────────── */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ───────────── Types ───────────── */
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
  pickup: { id: string; name: string; picture_url: string | null } | null;
  destination: { id: string; name: string; picture_url: string | null } | null;
};

type Vehicle = { id: string; name: string; operator_id: string | null; active: boolean | null; minseats: number; maxseats: number; };
type Assignment = { route_id: string; vehicle_id: string; is_active: boolean; preferred: boolean };

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
export default function OperatorRoutesTilesPage() {
  /* ps_user + lock behaviour */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.operator_admin && u.operator_id) setOperatorId(u.operator_id);
    } catch {
      setPsUser(null);
    }
  }, []);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* lookups + state */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, { pu: string | null; de: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  /* initial data */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, r, a] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb
          .from("routes")
          .select(`
            id, route_name, name, frequency,
            pickup:pickup_id ( id, name, picture_url ),
            destination:destination_id ( id, name, picture_url )
          `)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        sb.from("route_vehicle_assignments").select("route_id,vehicle_id,is_active,preferred"),
      ]);
      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.data) {
        const rows = (r.data as any[]).map((row) => ({
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup: row.pickup ? { id: row.pickup.id, name: row.pickup.name, picture_url: row.pickup.picture_url } : null,
          destination: row.destination ? { id: row.destination.id, name: row.destination.name, picture_url: row.destination.picture_url } : null,
        })) as RouteRow[];
        setRoutes(rows);
      }
      if (a.data) setAssignments((a.data as Assignment[]) || []);

      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  /* vehicles for current operator (for preferred/assigned summary on tiles) */
  useEffect(() => {
    if (!operatorId) return;
    let off = false;
    (async () => {
      const { data, error } = await sb
        .from("vehicles")
        .select("id,name,operator_id,active,minseats,maxseats")
        .eq("operator_id", operatorId)
        .eq("active", true)
        .order("name");
      if (!off) {
        if (error) setMsg(error.message);
        setVehicles((data as Vehicle[]) || []);
      }
    })();
    return () => { off = true; };
  }, [operatorId]);

  /* thumbnails */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const pu = await resolveStorageUrl(r.pickup?.picture_url ?? null);
          const de = await resolveStorageUrl(r.destination?.picture_url ?? null);
          return [r.id, { pu, de }] as const;
        })
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [routes]);

  /* assignment map for this operator */
  const asnByRoute = useMemo(() => {
    const allowed = new Set(vehicles.map(v => v.id));
    const m = new Map<string, Assignment[]>();
    assignments
      .filter(a => allowed.has(a.vehicle_id) && a.is_active)
      .forEach(a => {
        if (!m.has(a.route_id)) m.set(a.route_id, []);
        m.get(a.route_id)!.push(a);
      });
    return m;
  }, [assignments, vehicles]);

  /* filter text */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return routes;
    return routes.filter(r =>
      (r.route_name || r.name || "").toLowerCase().includes(s) ||
      (r.pickup?.name || "").toLowerCase().includes(s) ||
      (r.destination?.name || "").toLowerCase().includes(s)
    );
  }, [routes, q]);

  const lockedName =
    operatorLocked &&
    (psUser?.operator_name || operators.find(o => o.id === psUser?.operator_id)?.name || psUser?.operator_id);

  return (
    <div className="p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">
          Tap a route tile to manage assignments for that route.
          {operatorLocked && <> Showing vehicles for <strong>{lockedName}</strong>.</>}
        </p>
      </header>

      {/* operator picker */}
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

        <input
          className="ml-auto border rounded-lg px-3 py-2"
          placeholder="Search routes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* tiles */}
      {loading ? (
        <div className="rounded-2xl border bg-white p-4 shadow">Loading…</div>
      ) : !operatorId ? (
        <div className="rounded-2xl border bg-white p-4 shadow">
          {operatorLocked ? "No operator is linked to this account." : "Choose an Operator to view assignments."}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-white p-4 shadow">No routes.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => {
            const t = thumbs[r.id] || { pu: null, de: null };
            const asn = asnByRoute.get(r.id) || [];
            const preferred = asn.find(a => a.preferred);
            const preferredName = preferred
              ? (vehicles.find(v => v.id === preferred.vehicle_id)?.name ?? "—")
              : null;

            return (
              <Link
                key={r.id}
                href={`/operator-admin/routes/edit/${r.id}`}
                className="group rounded-2xl border bg-white overflow-hidden shadow hover:shadow-md transition"
              >
                {/* collage */}
                <div className="w-full aspect-[16/9] grid grid-cols-2">
                  <div className="relative">
                    {t.pu ? (
                      <img
                        src={t.pu}
                        alt={r.pickup?.name || "pickup"}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ objectPosition: "50% 40%" }}
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-neutral-400 bg-neutral-100">No image</div>
                    )}
                  </div>
                  <div className="relative border-l">
                    {t.de ? (
                      <img
                        src={t.de}
                        alt={r.destination?.name || "destination"}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ objectPosition: "50% 40%" }}
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-neutral-400 bg-neutral-100">No image</div>
                    )}
                  </div>
                </div>

                {/* meta */}
                <div className="p-3 space-y-1">
                  <div className="font-medium truncate">
                    {r.route_name || r.name || `${r.pickup?.name ?? ""} → ${r.destination?.name ?? ""}`}
                  </div>
                  <div className="text-sm text-neutral-600 truncate">
                    {r.pickup?.name ?? "—"} • {r.destination?.name ?? "—"}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                      {r.frequency || "—"}
                    </span>
                    {preferredName && (
                      <span className="text-xs px-2 py-0.5 rounded-full border bg-yellow-100">
                        Preferred: {preferredName}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
