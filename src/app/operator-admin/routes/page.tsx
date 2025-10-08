"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
};

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  // Try public first
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  // Fallback signed
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/* ===================================================================== */

export default function OperatorRoutesTilesPage() {
  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

  /* Lookups + state */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Which operator to view (site admin can choose; op-admin locked) */
  const [operatorId, setOperatorId] = useState("");
  const lockedOperatorName =
    isOpAdmin && psUser?.operator_id
      ? psUser?.operator_name ||
        operators.find((o) => o.id === psUser.operator_id)?.name ||
        psUser.operator_id
      : "";

  /* Thumbs (pickup + destination) */
  const [thumbs, setThumbs] = useState<
    Record<string, { pickup: string | null; destination: string | null }>
  >({});

  /* Search */
  const [q, setQ] = useState("");

  /* Initial load */
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
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `
          )
          .order("created_at", { ascending: false }),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (r.error) setMsg(r.error.message);
      if (r.data) setRoutes((r.data as RouteRow[]) || []);

      // lock operator for op-admins
      if (isOpAdmin && psUser?.operator_id) setOperatorId(psUser.operator_id);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpAdmin, psUser?.operator_id]);

  /* Resolve images for tiles */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        routes.map(async (r) => {
          const pu = await resolveStorageUrl(r.pickup?.picture_url || null);
          const du = await resolveStorageUrl(r.destination?.picture_url || null);
          return [r.id, { pickup: pu, destination: du }] as const;
        })
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [routes]);

  /* Filter: operator + text */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = routes;
    const list = base.filter(Boolean);
    const byText = !s
      ? list
      : list.filter((r) =>
          [
            r.route_name || "",
            r.name || "",
            r.pickup?.name || "",
            r.destination?.name || "",
            r.frequency || "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(s)
        );
    return byText;
  }, [routes, q]);

  return (
    <div className="space-y-6 p-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Routes</h1>
          <p className="text-neutral-600">
            Assign and manage vehicles per route. Click any tile to edit.
            {isOpAdmin && (
              <>
                {" "}
                Showing routes for <strong>{lockedOperatorName}</strong>.
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isOpAdmin && (
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

          <input
            className="border rounded-full px-3 py-2"
            placeholder="Search routes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          {/* NEW button goes to edit/new if you decide to add creation later */}
        </div>
      </header>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      {!isOpAdmin && !operatorId ? (
        <div className="p-4 rounded-2xl border bg-white">Choose an Operator to manage assignments.</div>
      ) : loading ? (
        <div className="p-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 rounded-2xl border bg-white">No routes.</div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => {
            const t = thumbs[r.id] || { pickup: null, destination: null };
            const title = r.route_name || r.name || "Route";
            const subtitle = `${r.pickup?.name ?? "—"} • ${r.destination?.name ?? "—"}`;
            return (
              <Link
                key={r.id}
                href={`/operator-admin/routes/${r.id}?op=${encodeURIComponent(
                  isOpAdmin ? psUser?.operator_id || "" : operatorId
                )}`}
                className="rounded-2xl border bg-white overflow-hidden shadow hover:shadow-md transition"
              >
                {/* Split image header (pickup left, destination right) */}
                <div className="grid grid-cols-2 w-full h-40 sm:h-48 bg-neutral-100">
                  <div className="border-r overflow-hidden">
                    {t.pickup ? (
                      <img
                        src={t.pickup}
                        alt={r.pickup?.name || "Pickup"}
                        className="w-full h-full object-cover object-center"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-neutral-400 text-xs">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="overflow-hidden">
                    {t.destination ? (
                      <img
                        src={t.destination}
                        alt={r.destination?.name || "Destination"}
                        className="w-full h-full object-cover object-center"
                      />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-neutral-400 text-xs">
                        No image
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-3">
                  <div className="font-medium">{title}</div>
                  <div className="text-xs text-neutral-600">{subtitle}</div>
                  {r.frequency && (
                    <div className="mt-2">
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-neutral-300 text-neutral-600">
                        {r.frequency}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
