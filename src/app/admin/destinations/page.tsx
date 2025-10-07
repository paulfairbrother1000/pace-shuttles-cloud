"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Destination = {
  id: UUID;
  name: string;
  picture_url: string | null;
  description: string | null;
  country_id: UUID | null;
  url: string | null;
};

// --- SAME normalizer your homepage uses ---
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) {
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`
          : `${raw}?v=5`;
      }
      return raw; // already a full non-storage url
    } catch {
      /* fallthrough */
    }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

export default function AdminDestinations() {
  const [rows, setRows] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase not configured");
        setLoading(false);
        return;
      }
      setErr(null);
      setLoading(true);

      const { data, error } = await supabase
        .from("destinations")
        .select("id,name,picture_url,description,country_id,url")
        .order("name", { ascending: true });

      if (off) return;
      if (error) setErr(error.message);
      setRows((data || []) as Destination[]);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(s));
  }, [q, rows]);

  return (
    <div className="px-6 py-6 mx-auto max-w-[1200px]">
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold">Admin • Destinations</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="border rounded-full px-3 py-1.5 text-sm"
          />
          {/* ✅ correct path for create */}
          <Link
            href="/admin/destinations/edit/new"
            className="px-3 py-1.5 rounded-full bg-blue-600 text-white text-sm"
          >
            New Destination
          </Link>
        </div>
      </header>

      {err && (
        <div className="p-3 mb-4 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* quick-create tile */}
          <Link
            href="/admin/destinations/edit/new"
            className="rounded-2xl border bg-white shadow hover:shadow-md transition overflow-hidden flex items-center justify-center aspect-[4/3]"
          >
            <span className="text-blue-700 font-medium">＋ New Destination</span>
          </Link>

          {filtered.map((d) => {
            const img = publicImage(d.picture_url);
            return (
              // ✅ correct path for edit
              <Link
                key={d.id}
                href={`/admin/destinations/edit/${d.id}`}
                className="rounded-2xl border bg-white shadow hover:shadow-md transition overflow-hidden"
              >
                <div className="relative w-full aspect-[4/3]">
                  {img ? (
                    <Image
                      src={img}
                      alt={d.name}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                  ) : (
                    <div className="h-full w-full bg-neutral-100" />
                  )}
                </div>
                <div className="p-3">
                  <div className="font-medium">{d.name}</div>
                  {d.description && (
                    <div className="text-sm text-neutral-600 line-clamp-2">
                      {d.description}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
