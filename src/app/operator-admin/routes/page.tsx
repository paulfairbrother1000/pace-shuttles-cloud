// src/app/operator-admin/routes/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, SupabaseClient } from "@supabase/ssr";

type PsUser = {
  id: string;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type RouteTile = {
  id: string;
  country_id: string | null;
  frequency: string | null;
  pickup_time: string | null;
  approx_duration_mins: number | null;
  journey_type_id: string | null;
  pickup: { id: string; name: string; picture_url: string | null } | null;
  destination: { id: string; name: string; picture_url: string | null } | null;
};

type JourneyType = { id: string; name: string };
type Country = { id: string; name: string };

const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

export default function OperatorRoutesIndex() {
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

  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [rows, setRows] = useState<RouteTile[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u || null);
    } catch {}
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

      // countries + types (for chips)
      const [cQ, tQ] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
      ]);
      setCountries((cQ.data || []) as Country[]);
      setTypes((tQ.data || []) as JourneyType[]);

      // routes list
      const rQ = await sb
        .from("routes")
        .select(
          `
          id, country_id, frequency, pickup_time, approx_duration_mins, journey_type_id,
          pickup:pickup_id ( id, name, picture_url ),
          destination:destination_id ( id, name, picture_url )
        `
        )
        .order("created_at", { ascending: false });

      if (off) return;

      if (rQ.error) {
        setMsg(rQ.error.message);
      } else {
        setRows((rQ.data as RouteTile[]) || []);
      }
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  const countryName = (id: string | null | undefined) =>
    countries.find((c) => c.id === id)?.name ?? "—";
  const typeName = (id: string | null | undefined) =>
    types.find((t) => t.id === id)?.name ?? "—";

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const lhs = `${r.pickup?.name ?? ""} ${r.destination?.name ?? ""} ${countryName(
        r.country_id
      )} ${typeName(r.journey_type_id)}`.toLowerCase();
      return lhs.includes(s);
    });
  }, [rows, q, countries.length, types.length]);

  return (
    <div className="bg-white min-h-[calc(100vh-6rem)] p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">
          {operatorLocked
            ? "Operator Admin view."
            : "Search and click a route to edit."}
        </p>
      </header>

      {/* Controls (NO operator/site-admin segmented control) */}
      <div className="flex flex-wrap gap-2 items-center">
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

      {/* Tiles */}
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
            {filtered.map((r) => (
              <Link
                key={r.id}
                href={`/operator-admin/routes/edit/${r.id}`}
                className="block rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
              >
                {/* Image collage */}
                <div className="grid grid-cols-2">
                  <div className="relative h-28 sm:h-36">
                    {r.pickup?.picture_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.pickup.picture_url}
                        alt={r.pickup.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-neutral-100" />
                    )}
                  </div>
                  <div className="relative h-28 sm:h-36">
                    {r.destination?.picture_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.destination.picture_url}
                        alt={r.destination.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-neutral-100" />
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-3 space-y-1">
                  <h3 className="font-medium leading-tight">
                    {(r.pickup?.name ?? "—") + " → " + (r.destination?.name ?? "—")}
                  </h3>
                  <p className="text-sm text-neutral-600">
                    {r.frequency || "—"}
                    {r.pickup_time ? ` • ${r.pickup_time}` : ""}
                    {r.approx_duration_mins != null ? ` • ${r.approx_duration_mins} mins` : ""}
                  </p>

                  {/* chips: country + type */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="text-xs px-2 py-[2px] rounded-full border bg-neutral-50">
                      {countryName(r.country_id)}
                    </span>
                    <span className="text-xs px-2 py-[2px] rounded-full border bg-neutral-50">
                      {typeName(r.journey_type_id)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
