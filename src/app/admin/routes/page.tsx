"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) for READS only ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type RouteRow = {
  id: string;
  route_name: string | null;
  name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  frequency: string | null;
  is_active: boolean | null;
  journey_type_id: string | null;
  transport_type: string | null;
  season_from: string | null;
  season_to: string | null;
};
type Country = { id: string; name: string };
type Pickup = { id: string; name: string; picture_url: string | null; country_id: string };
type Destination = { id: string; name: string; picture_url: string | null; country_id: string | null };
type JourneyType = { id: string; name: string };

const placeholder = "/placeholder.png";

/* Public image normalizer (same as Home) */
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
      return raw;
    } catch { /* ignore */ }
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

/* Collage (left=pickup, right=destination) */
function Collage({ left, right, alt }: { left?: string | null; right?: string | null; alt?: string }) {
  const l = publicImage(left) || placeholder;
  const r = publicImage(right) || placeholder;
  return (
    <div className="relative overflow-hidden rounded-t-2xl">
      <div className="grid grid-cols-2 h-44 w-full">
        <img src={l} alt={alt || "Pick-up"} className="h-full w-full object-cover" />
        <img src={r} alt={alt || "Destination"} className="h-full w-full object-cover" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1px] bg-white/70 mix-blend-overlay" />
    </div>
  );
}

export default function RoutesIndexPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [r, c, p, d, t] = await Promise.all([
        sb.from("routes").select("*").order("created_at", { ascending: false }),
        sb.from("countries").select("id,name"),
        sb.from("pickup_points").select("id,name,country_id,picture_url"),
        sb.from("destinations").select("id,name,country_id,picture_url"),
        sb.from("journey_types").select("id,name"),
      ]);
      if (off) return;
      if (r.error || c.error || p.error || d.error || t.error) {
        setMsg(r.error?.message || c.error?.message || p.error?.message || d.error?.message || t.error?.message || "Load failed");
      }
      setRoutes((r.data as RouteRow[]) || []);
      setCountries((c.data as Country[]) || []);
      setPickups((p.data as Pickup[]) || []);
      setDests((d.data as Destination[]) || []);
      setTypes((t.data as JourneyType[]) || []);
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  const countryName = (id: string | null | undefined) =>
    countries.find(c => c.id === id)?.name ?? "—";
  const jtName = (id: string | null | undefined, fallback?: string | null) =>
    types.find(t => t.id === id)?.name ?? (fallback || "—");
  const pu = (id: string | null | undefined) => pickups.find(p => p.id === id) || null;
  const de = (id: string | null | undefined) => dests.find(d => d.id === id) || null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return routes;
    return routes.filter(r =>
      (r.route_name || r.name || "").toLowerCase().includes(s) ||
      countryName(r.country_id).toLowerCase().includes(s) ||
      (pu(r.pickup_id)?.name || "").toLowerCase().includes(s) ||
      (de(r.destination_id)?.name || "").toLowerCase().includes(s) ||
      jtName(r.journey_type_id, r.transport_type).toLowerCase().includes(s)
    );
  }, [routes, q, countries, pickups, dests, types]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Routes</h1>
        <div className="ml-auto flex gap-2">
          <input
            className="border rounded-lg px-3 py-2 w-72 max-w-full"
            placeholder="Search routes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Link
            href="/admin/routes/edit/new"
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90"
          >
            New Route
          </Link>
        </div>
      </header>

      {msg && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* New tile */}
        <Link
          href="/admin/routes/edit/new"
          className="rounded-2xl border border-dashed bg-white hover:shadow transition flex items-center justify-center h-60"
        >
          <span className="text-blue-600 font-medium">+ New Route</span>
        </Link>

        {/* Route cards */}
        {loading ? (
          <div className="col-span-full rounded-2xl border bg-white p-4">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full rounded-2xl border bg-white p-4">No routes yet.</div>
        ) : (
          filtered.map(r => {
            const p = pu(r.pickup_id);
            const d = de(r.destination_id);
            const title = r.route_name || r.name || `${p?.name ?? "—"} → ${d?.name ?? "—"}`;
            return (
              <Link
                key={r.id}
                href={`/admin/routes/edit/${r.id}`}
                className="group rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow transition"
                title="Edit route"
              >
                <Collage left={p?.picture_url || null} right={d?.picture_url || null} alt={title} />
                <div className="p-3 space-y-1">
                  <div className="font-medium leading-tight">{title}</div>
                  <div className="text-xs text-neutral-600">
                    {countryName(r.country_id)} • {jtName(r.journey_type_id, r.transport_type)}
                    {r.frequency ? ` • ${r.frequency}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(r.is_active ?? true) ? (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">Active</span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-50 text-neutral-700 border">Inactive</span>
                    )}
                    {r.approx_duration_mins != null && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-50 text-neutral-700 border">
                        {r.approx_duration_mins} mins
                      </span>
                    )}
                    {r.approximate_distance_miles != null && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-50 text-neutral-700 border">
                        {r.approximate_distance_miles} mi
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
