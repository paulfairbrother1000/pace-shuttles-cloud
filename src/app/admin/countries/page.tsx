"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type UUID = string;

type Country = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null;
  created_at: string | null;
};

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

// inline SVG fallback (no network request)
const FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'>
      <rect width='100%' height='100%' fill='#f3f4f6'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#9ca3af' font-family='system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' font-size='16'>No image</text>
    </svg>`
  );

// match how we name files when uploading
function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Choose the best image URL for a country:
 * 1) normalize stored picture_url if present
 * 2) otherwise, try conventional storage keys under the "images" bucket:
 *    - countries/{code-lc}-{slug(name)}.jpg
 *    - countries/{code-lc}-{slug(name)}.png
 *    - countries/{code-lc}.jpg
 *    - countries/{code-lc}.png
 * Browser will 404 gracefully and onError we swap to FALLBACK.
 */
function bestCountryImage(c: Country): string {
  const explicit = publicImage(c.picture_url) || c.picture_url || "";
  if (explicit) return explicit;

  const code = (c.code || "").toLowerCase();
  const base = `countries/${code}${code ? "-" : ""}${slugify(c.name || "")}`;
  const candidates = [
    `${base}.jpg`,
    `${base}.png`,
    code ? `countries/${code}.jpg` : "",
    code ? `countries/${code}.png` : "",
  ].filter(Boolean) as string[];

  // normalize first candidate using publicImage (it will prepend bucket+host)
  const first = candidates[0] || "";
  return first ? publicImage(first) || "" : "";
}

export default function CountriesAdminTiles() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Country[]>([]);
  const [q, setQ] = useState("");

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
        const { data, error } = await sb
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
    return rows.filter((r) => r.name?.toLowerCase().includes(s));
  }, [rows, q]);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Countries</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="px-3 py-2 rounded-full bg-blue-600 text-white"
            onClick={() => router.push("/admin/countries/edit/new")}
          >
            New Country
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* New tile */}
          <button
            onClick={() => router.push("/admin/countries/edit/new")}
            className="h-[240px] rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition flex items-center justify-center"
          >
            <span className="text-blue-600">+ New Country</span>
          </button>

          {filtered.map((c) => {
            const initialSrc = bestCountryImage(c) || FALLBACK;
            return (
              <button
                key={c.id}
                onClick={() => router.push(`/admin/countries/edit/${c.id}`)}
                className="group rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition text-left overflow-hidden"
                title="Edit"
              >
                <div className="relative w-full h-[160px] overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={initialSrc}
                    alt={c.name || "Country"}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = FALLBACK;
                    }}
                  />
                </div>
                <div className="p-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-neutral-600 line-clamp-2">
                    {c.description || "—"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
