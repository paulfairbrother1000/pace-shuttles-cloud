// src/app/admin/transport-types/page.tsx

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
type PsUser = { id: string; site_admin?: boolean | null };

type TransportType = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  picture_url: string | null; // STORAGE PATH or full URL
  is_active: boolean;
  sort_order: number;
  created_at?: string | null;
};

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  // Prefer public URL; fall back to signed
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function TransportTypesIndexPage() {
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isSiteAdmin = Boolean(psUser?.site_admin);

  const [rows, setRows] = useState<TransportType[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  /* Who am I (site admin) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);

  /* Load types */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("transport_types")
        .select("id,name,slug,description,picture_url,is_active,sort_order,created_at")
        .order("sort_order", { ascending: false })
        .order("name");
      if (off) return;
      if (error) setMsg(error.message);
      setRows((data as TransportType[]) || []);
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  /* Resolve thumbnails */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolveStorageUrl(r.picture_url)] as const)
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        (r.slug ?? "").toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  if (!isSiteAdmin) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-semibold">Admin • Transport Types</h1>
        <p className="mt-2 text-neutral-600">This account is not a site admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Transport Types</h1>
        <div className="ml-auto flex gap-2">
          <input
            className="border rounded-lg px-3 py-2 w-72 max-w-full"
            placeholder="Search types…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Link
            href="/admin/transport-types/edit/new"
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90"
          >
            New Type
          </Link>
        </div>
      </header>

      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border bg-white p-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-white p-4">No transport types.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* New tile */}
          <Link
            href="/admin/transport-types/edit/new"
            className="rounded-2xl border border-dashed bg-white hover:shadow transition flex items-center justify-center h-60"
          >
            <span className="text-blue-600 font-medium">+ New Type</span>
          </Link>

          {filtered.map((t) => (
            <Link
              key={t.id}
              href={`/admin/transport-types/edit/${t.id}`}
              className="group rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow transition"
              title="Edit transport type"
            >
              <div className="h-40 w-full overflow-hidden bg-neutral-50">
                {thumbs[t.id] ? (
                  <img src={thumbs[t.id]!} alt={t.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm text-neutral-500">No image</div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="font-medium leading-tight">{t.name}</div>
                <div className="text-xs text-neutral-600">
                  {t.slug || "—"} • Sort {t.sort_order}
                </div>
                <div className="text-[11px]">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-[2px] border ${
                      t.is_active ? "border-green-600 text-green-700" : "border-neutral-400 text-neutral-600"
                    }`}
                  >
                    {t.is_active ? "Active" : "Hidden"}
                  </span>
                </div>
                {t.description && (
                  <div className="text-xs text-neutral-600 line-clamp-2">{t.description}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
