"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type UUID = string;

type Country = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null; // ← used for the tile image
  created_at: string | null;
};

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

const FALLBACK_SVG =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='400'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239ca3af' font-family='system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' font-size='16'%3ENo image%3C/text%3E%3C/svg%3E";

export default function AdminCountriesTilesPage() {
  const [rows, setRows] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await supabase
          .from("countries")
          .select("id,name,code,description,picture_url,created_at")
          .order("name");
        if (error) throw error;
        if (!off) setRows((data || []) as Country[]);
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
        (r.description ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Countries</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border rounded-lg px-3 py-2 text-sm min-w-[220px]"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm"
            onClick={() => (window.location.href = "/admin/countries/edit/new")}
          >
            New Country
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* New tile */}
        <button
          className="rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition text-left"
          onClick={() => (window.location.href = "/admin/countries/edit/new")}
        >
          <div className="h-[180px] bg-neutral-100 rounded-t-2xl grid place-items-center text-neutral-400">
            + New Country
          </div>
          <div className="p-3 text-neutral-500 text-sm">Create a new country</div>
        </button>

        {/* Data tiles */}
        {loading ? (
          <div className="col-span-full p-4 rounded-2xl border bg-white shadow">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-4 rounded-2xl border bg-white shadow">
            No countries found.
          </div>
        ) : (
          filtered.map((c) => {
            const imgSrc =
              publicImage(c.picture_url || undefined) ?? FALLBACK_SVG;

            return (
              <div
                key={c.id}
                className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden hover:shadow-md transition"
              >
                <button
                  className="block w-full text-left"
                  onClick={() =>
                    (window.location.href = `/admin/countries/edit/${c.id}`)
                  }
                >
                  <div className="relative w-full h-[180px] overflow-hidden bg-neutral-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgSrc}
                      alt={c.name || "Country"}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = FALLBACK_SVG;
                      }}
                    />
                  </div>

                  <div className="p-3 space-y-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-sm text-neutral-600 line-clamp-2">
                      {c.description || "—"}
                    </div>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
