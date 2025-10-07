"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type UUID = string;

type CountryRow = {
  id: UUID;
  name: string;
  description: string | null;
  picture_url: string | null; // stores full public URL or a storage key like "images/countries/foo.jpg"
};

function supa() {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return null;
}

/** Prefer full public URL; otherwise normalise short storage keys. */
function imgForCountry(url?: string | null) {
  const raw = (url || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw; // already a full URL (e.g., https://.../storage/v1/object/public/images/countries/xxx.jpg)
  return publicImage(raw) ?? undefined;      // handles "images/countries/xxx.jpg"
}

function truncate(s: string, n = 120) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

export default function AdminCountriesPage() {
  const router = useRouter();
  const client = useMemo(() => supa(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!client) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await client
          .from("countries")
          .select("id,name,description,picture_url")
          .order("name", { ascending: true });
        if (error) throw error;
        if (off) return;
        setRows((data || []) as CountryRow[]);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [client]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Countries</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border rounded-lg px-3 py-2 text-sm min-w-[220px]"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm"
            onClick={() => router.push("/admin/countries/edit/new")}
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

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* New tile */}
          <button
            onClick={() => router.push("/admin/countries/edit/new")}
            className="h-56 rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition text-blue-600"
            title="Create a new country"
          >
            <div className="h-full w-full grid place-items-center text-blue-600">
              + New Country
            </div>
          </button>

          {filtered.map((row) => {
            const src = imgForCountry(row.picture_url);
            return (
              <div
                key={row.id}
                className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden hover:shadow-md transition cursor-pointer"
                onClick={() => router.push(`/admin/countries/edit/${row.id}`)}
                title="Edit country"
              >
                <div className="relative h-48 w-full overflow-hidden bg-neutral-100">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={src}
                      alt={row.name || "Country"}
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => {
                        // hide a broken img gracefully
                        (e.currentTarget as HTMLImageElement).style.opacity = "0";
                      }}
                    />
                  ) : (
                    <div className="h-full w-full grid place-items-center text-sm text-neutral-400">
                      No image
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="font-medium text-lg">{row.name}</div>
                  <div className="text-neutral-600 text-sm">
                    {row.description ? truncate(row.description) : "—"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
