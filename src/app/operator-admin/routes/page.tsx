/* --- src/app/operator-admin/routes/page.tsx --- */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

/* Types */
type UUID = string;

type PsUser = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
};

type Operator = { id: UUID; name: string; country_id: UUID | null };

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

/* Supabase client (browser only) */
export default function RoutesIndex() {
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
  const [lockedCountryId, setLockedCountryId] = useState<string>("");

  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [q, setQ] = useState("");
  const [countryId, setCountryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Load ps_user + lock operator-admin to their operator country */
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const raw = localStorage.getItem("ps_user");
        const u = raw ? (JSON.parse(raw) as PsUser) : null;
        if (off) return;
        setPsUser(u);

        // Operator admins must only see routes for their country.
        // Site admins are not locked.
        if (u?.operator_admin && !u?.site_admin && u.operator_id) {
          const { data, error } = await sb
            .from("operators")
            .select("id,name,country_id")
            .eq("id", u.operator_id)
            .maybeSingle();

          if (!off && !error) {
            const op = (data as Operator | null) || null;
            const cid = op?.country_id ?? "";
            setLockedCountryId(cid);
            setCountryId(cid); // force filter to operator's country
          }
        }
      } catch {
        if (!off) {
          setPsUser(null);
          setLockedCountryId("");
        }
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // HARD LOCK: operator admins only see their country routes.
    const effectiveCountryId = lockedCountryId || countryId;

    if (effectiveCountryId) {
      base = base.filter((r) => {
        const c1 = r.pickup?.country_id || null;
        const c2 = r.destination?.country_id || null;
        return c1 === effectiveCountryId || c2 === effectiveCountryId;
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
  }, [rows, q, countryId, typeId, lockedCountryId]);

  const countryName = (id?: string | null) =>
    countries.find((c) => c.id === id)?.name || "";

  const journeyTypeName = (id?: string | null) =>
    id ? types.find((t) => t.id === id)?.name ?? "" : "";

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
          disabled={!!lockedCountryId}
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

        {psUser?.site_admin ? (
          <Link
            href="/operator-admin/routes/edit/new"
            className="ml-auto inline-flex items-center rounded-full px-4 py-2 bg-black text-white text-sm"
          >
            New Route
          </Link>
        ) : (
          <div className="ml-auto text-sm text-neutral-500">
            Routes are defined by Site Admin.
          </div>
        )}
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
            const transportType = journeyTypeName(r.journey_type_id);
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
                    {transportType && (
                      <span className="px-2 py-[2px] rounded-full border bg-neutral-50">
                        {transportType}
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
  const url = publicImage(src);

  if (!url) {
    return (
      <div className="w-full h-40 sm:h-48 bg-neutral-100 grid place-items-center text-neutral-400">
        No image
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className="w-full h-40 sm:h-48 object-cover"
    />
  );
}
