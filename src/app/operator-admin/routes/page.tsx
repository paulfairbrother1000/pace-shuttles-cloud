"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";

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

type Operator = { id: string; name: string };

type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup: { name: string; picture_url: string | null } | null;
  destination: { name: string; picture_url: string | null } | null;
};

type ThumbMap = Record<
  string,
  { pickupUrl: string | null; destUrl: string | null }
>;

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

/** Always return a browser-loadable URL.
 * We use signed URLs so this works with private buckets. */
async function signedUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365); // 1 year
  if (error) return null;
  return data?.signedUrl ?? null;
}

function matches(s: string, q: string) {
  return s.toLowerCase().includes(q.toLowerCase());
}

/* ===================================================================== */

export default function OperatorRoutesTilesPage() {
  /* ps_user (locks operator for operator admins) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* Operator context */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState("");

  /* Data */
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [thumbs, setThumbs] = useState<ThumbMap>({});
  const [loading, setLoading] = useState(true);

  /* UI */
  const [q, setQ] = useState("");

  /* Read ps_user + preselect operator for operator admins */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.operator_admin && u.operator_id) {
        setOperatorId((cur) => cur || u.operator_id!);
      }
    } catch {
      setPsUser(null);
    }
  }, []);

  const lockedOperatorName =
    (operatorLocked &&
      (psUser?.operator_name ||
        operators.find((o) => o.id === psUser!.operator_id!)?.name)) ||
    "";

  /* Load operators + routes (with pickup/destination + picture_url) */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

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
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `
          )
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.data) {
        const rows: RouteRow[] = ((r.data as any[]) || []).map((row) => ({
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          pickup: row.pickup
            ? {
                name: String(row.pickup.name),
                picture_url: row.pickup.picture_url ?? null,
              }
            : null,
          destination: row.destination
            ? {
                name: String(row.destination.name),
                picture_url: row.destination.picture_url ?? null,
              }
            : null,
        }));
        setRoutes(rows);
      }

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Resolve signed URLs for each tile (pickup + destination) */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const pickupUrl = await signedUrl(r.pickup?.picture_url ?? null);
          const destUrl = await signedUrl(r.destination?.picture_url ?? null);
          return [r.id, { pickupUrl, destUrl }] as const;
        })
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [routes]);

  /* Filter (client-side) */
  const filtered = useMemo(() => {
    const s = q.trim();
    if (!s) return routes;
    return routes.filter(
      (r) =>
        matches(r.route_name || r.name || "", s) ||
        matches(r.pickup?.name || "", s) ||
        matches(r.destination?.name || "", s) ||
        matches(r.frequency || "", s)
    );
  }, [routes, q]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-sm text-neutral-700">Operator</div>
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
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}

        <input
          className="ml-auto border rounded-lg px-3 py-2 w-64"
          placeholder="Search routes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="p-4">Loading…</div>
        ) : !operatorId ? (
          <div className="p-4 col-span-full">
            {operatorLocked
              ? "No operator is linked to this account."
              : "Choose an Operator to manage assignments."}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 col-span-full">No routes.</div>
        ) : (
          filtered.map((r) => {
            const t = thumbs[r.id] || { pickupUrl: null, destUrl: null };
            const title = r.route_name || r.name || "Route";
            const sub = `${r.pickup?.name ?? "—"} • ${r.destination?.name ?? "—"}`;

            return (
              <Link
                key={r.id}
                href={`/operator-admin/routes/${r.id}?op=${encodeURIComponent(
                  operatorId
                )}`}
                className="block rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
              >
                {/* collage */}
                <div className="relative h-40 sm:h-48 w-full flex">
                  <img
                    src={t.pickupUrl ?? ""}
                    alt={r.pickup?.name || "pickup"}
                    className="w-1/2 h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                  <img
                    src={t.destUrl ?? ""}
                    alt={r.destination?.name || "destination"}
                    className="w-1/2 h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.opacity = "0.2";
                    }}
                  />
                </div>

                {/* caption */}
                <div className="p-3 space-y-1">
                  <div className="font-medium">{title}</div>
                  <div className="text-sm text-neutral-600 truncate">{sub}</div>
                  {r.frequency && (
                    <div className="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
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
