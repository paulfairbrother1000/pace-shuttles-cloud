"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

/* -------- Supabase (client-side) -------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* -------- Types -------- */
type Country = { id: string; name: string };
type TransportType = { id: string; name: string };
type TransportPlace = { id: string; transport_type_id: string; name: string };

type Row = {
  id: string;
  name: string;
  country_id: string;
  picture_url: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  transport_type_id: string | null;
  transport_type_place_id: string | null;
};

export default function AdminPickupPointsTilesPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<TransportType[]>([]);
  const [places, setPlaces] = useState<TransportPlace[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const countryName = (id: string | null) =>
    countries.find((c) => c.id === id)?.name ?? (id ?? "");
  const typeName = (id: string | null) =>
    types.find((t) => t.id === id)?.name ?? (id ?? "");
  const placeName = (id: string | null) =>
    places.find((p) => p.id === id)?.name ?? (id ?? "");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const [cQ, tQ, pQ, dQ] = await Promise.all([
          sb.from("countries").select("id,name").order("name"),
          sb.from("transport_types").select("id,name").order("name"),
          sb.from("transport_type_places").select("id,transport_type_id,name").order("name"),
          sb.from("pickup_points").select("*").order("name"),
        ]);
        if (cQ.error) throw cQ.error;
        if (tQ.error) throw tQ.error;
        if (pQ.error) throw pQ.error;
        if (dQ.error) throw dQ.error;

        if (off) return;
        setCountries((cQ.data || []) as Country[]);
        setTypes((tQ.data || []) as TransportType[]);
        setPlaces((pQ.data || []) as TransportPlace[]);
        setRows((dQ.data || []) as Row[]);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name?.toLowerCase().includes(s) ||
        countryName(r.country_id).toLowerCase().includes(s) ||
        typeName(r.transport_type_id).toLowerCase().includes(s) ||
        placeName(r.transport_type_place_id).toLowerCase().includes(s)
    );
  }, [rows, q, countries, types, places]);

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-5">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin • Pick-up Points</h1>
          <p className="text-neutral-600 text-sm">
            Click a tile to edit, or add a new pick-up point.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="border rounded-lg px-3 py-2 text-sm w-64"
            placeholder="Search pick-up points…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="rounded-full px-4 py-2 text-white text-sm"
            style={{ backgroundColor: "#2563eb" }}
            onClick={() => (window.location.href = "/admin/pickups/edit/new")}
          >
            New Pick-up Point
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      <section>
        {loading ? (
          <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 border rounded-xl bg-white shadow">
            No pick-up points found.
          </div>
        ) : (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {/* New tile */}
            <button
              onClick={() => (window.location.href = "/admin/pickups/edit/new")}
              className="h-[260px] rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition overflow-hidden flex items-center justify-center"
              title="Create a new pick-up point"
            >
              <span className="text-blue-600 font-medium">+ New Pick-up Point</span>
            </button>

            {filtered.map((r) => {
              const imgSrc = publicImage(r.picture_url) || "";
              const line = `${countryName(r.country_id)} • ${typeName(r.transport_type_id)}${
                r.transport_type_place_id ? ` — ${placeName(r.transport_type_place_id)}` : ""
              }`;

              return (
                <article
                  key={r.id}
                  className="rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition overflow-hidden cursor-pointer"
                  onClick={() => (window.location.href = `/admin/pickups/edit/${r.id}`)}
                  title="Edit pick-up point"
                >
                  <div className="relative h-[180px] w-full overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc || "/placeholder.png"}
                      alt={r.name || "Pick-up point"}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/placeholder.png";
                      }}
                    />
                  </div>

                  <div className="p-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-neutral-600">{line}</div>
                    {r.description && (
                      <p className="text-xs text-neutral-700 mt-1 line-clamp-2">
                        {r.description}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
