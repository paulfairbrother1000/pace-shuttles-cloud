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
          {/* New tile (big touch target) */}
          <button
            onClick={() => router.push("/admin/countries/edit/new")}
            className="h-[240px] rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition flex items-center justify-center"
          >
            <span className="text-blue-600">+ New Country</span>
          </button>

          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/admin/countries/edit/${c.id}`)}
              className="group rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition text-left overflow-hidden"
              title="Edit"
            >
              <div className="relative w-full h-[160px] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicImage(c.picture_url) || "/placeholder.png"}
                  alt={c.name || "Country"}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).src = "/placeholder.png")}
                />
              </div>
              <div className="p-3">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-neutral-600 line-clamp-2">
                  {c.description || "—"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
