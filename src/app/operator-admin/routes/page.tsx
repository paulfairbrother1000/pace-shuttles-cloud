// src/app/operator-admin/routes/page.tsx
"use client";

// force purely client rendering — literals only (no `as const`, no functions)
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const dynamicParams = true;

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, SupabaseClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type UUID = string;

type Country = { id: UUID; name: string };
type RouteRow = {
  id: UUID;
  country_id: UUID | null;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  journey_type_id: string | null;
  pickup?: { id: UUID; name: string; country_id: UUID | null; picture_url: string | null } | null;
  destination?: { id: UUID; name: string; country_id: UUID | null; picture_url: string | null } | null;
};

/* ---------- Safe client Supabase ---------- */
const sb: SupabaseClient | null =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function OperatorRoutesIndex() {
  if (!sb) return null;

  const [countries, setCountries] = useState<Country[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // simple filters
  const [countryId, setCountryId] = useState<string>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);

      const [cQ, rQ] = await Promise.all([
        sb!.from("countries").select("id,name").order("name"),
        sb!
          .from("routes")
          .select(
            `
            id, country_id, route_name, name, frequency, pickup_time, approx_duration_mins, journey_type_id,
            pickup:pickup_id ( id, name, country_id, picture_url ),
            destination:destination_id ( id, name, country_id, picture_url )
          `
          )
          .order("created_at", { ascending: false }) // ok if column exists; harmless otherwise
      ]);

      if (off) return;

      if (cQ.error || rQ.error) {
        setMsg(cQ.error?.message || rQ.error?.message || "Load failed.");
      }

      setCountries((cQ.data || []) as Country[]);
      setRoutes((rQ.data || []) as any);
      setLoading(false);
    })();

    return () => {
      off = true;
    };
  }, []);

  const countryName = (id: string | null | undefined) =>
    countries.find((c) => c.id === id)?.name ?? "—";

  // derive badge: prefer explicit routes.country_id, otherwise from pickup/destination
  const routeCountryId = (r: RouteRow) =>
    r.country_id || r.pickup?.country_id || r.destination?.country_id || null;

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return routes.filter((r) => {
      const cid = routeCountryId(r);
      if (countryId && cid !== countryId) return false;
      if (!ql) return true;
      const lhs = [
        r.name || "",
        r.route_name || "",
        r.frequency || "",
        r.pickup?.name || "",
        r.destination?.name || "",
        countryName(cid),
      ]
        .join(" ")
        .toLowerCase();
      return lhs.includes(ql);
    });
  }, [routes, q, countryId, countries.length]);

  return (
    <div className="bg-white min-h-[calc(100vh-6rem)] p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">
          Manage routes. Click a tile to edit, assign vehicles, and set preferences.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="border rounded-lg px-3 py-2"
          value={countryId}
          onChange={(e) => setCountryId(e.target.value)}
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          className="border rounded-lg px-3 py-2"
          placeholder="Search route, pickup, destination…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <Link
          href="/operator-admin/routes/edit/new"
          className="ml-auto inline-flex items-center rounded-full px-4 py-2 bg-black text-white text-sm"
        >
          New Route
        </Link>
      </div>

      {/* Grid */}
      <section>
        {msg && (
          <div className="mb-2 p-3 rounded-lg border bg-rose-50 text-rose-700 text-sm">{msg}</div>
        )}

        {loading ? (
          <div className="p-4 rounded-2xl border bg-white shadow">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 rounded-2xl border bg-white shadow">No routes found.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => {
              const cid = routeCountryId(r);
              return (
                <Link
                  key={r.id}
                  href={`/operator-admin/routes/edit/${r.id}`}
                  className="block rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
                >
                  {/* Simple banner with names */}
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <h3 className="font-medium leading-tight">
                        {r.pickup?.name || "—"} → {r.destination?.name || "—"}
                      </h3>
                      <span
                        className={cls(
                          "ml-auto text-xs px-2 py-[2px] rounded-full border bg-neutral-50 text-neutral-700"
                        )}
                        title={cid ? countryName(cid) : "—"}
                      >
                        {cid ? countryName(cid) : "—"}
                      </span>
                    </div>

                    <p className="text-sm text-neutral-600 mt-1">
                      {r.name || r.route_name || "Unnamed"} • {r.frequency || "No frequency"}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Pickup {r.pickup_time || "—"}
                      {r.approx_duration_mins != null ? ` • ${r.approx_duration_mins} mins` : ""}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
