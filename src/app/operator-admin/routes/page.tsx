"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
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
type Operator = { id: string; name: string };
type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
};
type Vehicle = { id: string; name: string; minseats: number; maxseats: number; active: boolean | null };

/* ---------- Image helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  // Try public first
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  // Signed fallback
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function OperatorRoutesTilesPage() {
  /* ps_user + operator context */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>("");

  /* data */
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  /* resolved image urls (id -> {pickup?, dest?}) */
  const [imgMap, setImgMap] = useState<Record<string, { p?: string | null; d?: string | null }>>({});

  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);
  const lockedOperatorName =
    (operatorLocked &&
      (psUser?.operator_name || operators.find(o => o.id === psUser!.operator_id!)?.name)) || "";

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

  /* lookups + routes */
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
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
      ]);

      if (off) return;

      setOperators((ops.data as Operator[]) || []);
      const rows: RouteRow[] = ((r.data as any[]) || []).map((row) => ({
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
      }));
      setRoutes(rows);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* resolve all tile images */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const p = await resolveStorageUrl(r.pickup?.picture_url ?? null);
          const d = await resolveStorageUrl(r.destination?.picture_url ?? null);
          return [r.id, { p, d }] as const;
        })
      );
      if (!cancelled) setImgMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [routes]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return routes;
    return routes.filter((r) =>
      (r.route_name || r.name || "").toLowerCase().includes(s) ||
      (r.pickup?.name || "").toLowerCase().includes(s) ||
      (r.destination?.name || "").toLowerCase().includes(s)
    );
  }, [routes, q]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-neutral-700">Operator</label>
        {operatorLocked ? (
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
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        <input
          className="ml-auto border rounded-lg px-3 py-2"
          placeholder="Search routes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="p-4">Loading…</div>
        ) : !operatorId ? (
          <div className="p-4">Choose an Operator to manage assignments.</div>
        ) : filtered.length === 0 ? (
          <div className="p-4">No routes.</div>
        ) : (
          filtered.map((r) => {
            const imgs = imgMap[r.id] || {};
            const title = r.route_name || r.name || "Route";
            return (
              <Link
                key={r.id}
                href={`/operator-admin/routes/${r.id}?op=${operatorId}`}
                className="block rounded-2xl border bg-white overflow-hidden shadow hover:shadow-md transition"
              >
                {/* split collage */}
                <div className="grid grid-cols-2 h-40 sm:h-48">
                  <div
                    className="bg-neutral-100"
                    style={{
                      backgroundImage: imgs.p ? `url(${imgs.p})` : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                    aria-label={r.pickup?.name || ""}
                  />
                  <div
                    className="bg-neutral-100"
                    style={{
                      backgroundImage: imgs.d ? `url(${imgs.d})` : undefined,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                    aria-label={r.destination?.name || ""}
                  />
                </div>

                <div className="p-3">
                  <div className="font-medium truncate">{title}</div>
                  <div className="text-sm text-neutral-600 truncate">
                    {(r.pickup?.name || "—")} • {(r.destination?.name || "—")}
                  </div>
                  {r.frequency && (
                    <div className="mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs">
                      {r.frequency}
                    </div>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
