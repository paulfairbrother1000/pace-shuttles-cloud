/* --- src/app/operator-admin/routes/page.tsx --- */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

/* Types */
type UUID = string;

type RouteRow = {
  id: UUID;
  name: string | null;
  route_name: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  journey_type_id: UUID | null;
  pickup?: {
    id: UUID;
    name: string;
    picture_url: string | null;
    country_id: UUID | null;
  } | null;
  destination?: {
    id: UUID;
    name: string;
    picture_url: string | null;
    country_id: UUID | null;
  } | null;
};

type JourneyType = { id: UUID; name: string };
type Country = { id: UUID; name: string };

/* Helpers */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

export default function RoutesIndex() {
  /* safe client */
  const sb: SupabaseClient | null =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
      : null;
  if (!sb) return null;

  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [q, setQ] = useState("");
  const [countryId, setCountryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [cQ, tQ, rQ] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb
          .from("routes")
          .select(
            `
            id, name, route_name, frequency, pickup_time, approx_duration_mins, journey_type_id,
            pickup:pickup_id ( id, name, picture_url, country_id ),
            destination:destination_id ( id, name, picture_url, country_id )
          `
          )
          .order("created_at", { ascending: false }),
      ]);

      if (off) return;

      if (cQ.error || tQ.error || rQ.error) {
        setMsg(
          cQ.error?.message ||
            tQ.error?.message ||
            rQ.error?.message ||
            "Load failed"
        );
      } else {
        setCountries((cQ.data as Country[]) || []);
        setTypes((tQ.data as JourneyType[]) || []);
        setRows((rQ.data as RouteRow[]) || []);
      }
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let base = rows;
    if (countryId) {
      base = base.filter((r) => {
        const c1 = r.pickup?.country_id || null;
        const c2 = r.destination?.country_id || null;
        return c1 === countryId || c2 === countryId;
      });
    }
    if (typeId) base = base.filter((r) => (r.journey_type_id || "") === typeId);

    const s = q.trim().toLowerCase();
    if (!s) return base;

    const includes = (v?: string | null) => (v || "").toLowerCase().includes(s);
    return base.filter(
      (r) =>
        includes(r.name) ||
        includes(r.route_name) ||
        includes(r.pickup?.name) ||
        includes(r.destination?.name)
    );
  }, [rows, q, countryId, typeId]);

  const countryName = (id?: string | null) =>
    countries.find((c) => c.id === id)?.name || "";

  return (
    <div className="bg-white min-h-[calc(100vh-6rem)] p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">
          Manage route definitions and preferred vehicle assignments.
        </p>
      </header>

      {/* Controls (no Operator/Site toggle) */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="border rounded-lg px-3 py-2"
          value={countryId}
          onChange={(e) => setCountryId(e.target.value)}
        >
          <option value="">All Countries</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="border rounded-lg px-3 py-2"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
        >
          <option value="">All Transport Types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <input
          className="border rounded-lg px-3 py-2"
          placeholder="Search routes…"
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

      {msg && (
        <div className="p-3 rounded-lg border bg-rose-50 text-rose-700 text-sm">
          {msg}
        </div>
      )}

      {/* Tiles */}
      {loading ? (
        <div className="p-4 rounded-2xl border bg-white shadow">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 rounded-2xl border bg-white shadow">
          No routes found.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const countryIdBest =
              r.pickup?.country_id || r.destination?.country_id || "";
            const country = countryName(countryIdBest);
            const title =
              r.name ||
              `${r.pickup?.name || "—"} → ${r.destination?.name || "—"}`;

            return (
              <Link
                key={r.id}
                href={`/operator-admin/routes/edit/${r.id}`}
                className="block rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
              >
                {/* Simple side-by-side images */}
                <div className="grid grid-cols-2">
                  <Thumb
                    src={r.pickup?.picture_url}
                    alt={r.pickup?.name || "Pickup"}
                  />
                  <Thumb
                    src={r.destination?.picture_url}
                    alt={r.destination?.name || "Destination"}
                  />
                </div>

                <div className="p-3 space-y-1">
                  <h3 className="font-medium leading-tight">{title}</h3>

                  <p className="text-sm text-neutral-600">
                    {r.frequency || "—"} • {r.pickup_time || "—"}
                    {typeof r.approx_duration_mins === "number"
                      ? ` • ${r.approx_duration_mins} mins`
                      : ""}
                  </p>

                  <div className="flex gap-2 flex-wrap text-xs mt-1">
                    {country && (
                      <span className="px-2 py-[2px] rounded-full border bg-neutral-50">
                        {country}
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

function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="w-full h-40 sm:h-48 bg-neutral-100 grid place-items-center text-neutral-400">
        No image
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-40 sm:h-48 object-cover"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
