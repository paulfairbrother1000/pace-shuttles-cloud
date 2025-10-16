/*--- src/app/operator-admin/vehicles/page.tsx ---*/

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, SupabaseClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};
type Operator = { id: string; name: string; country_id: string | null };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };
type VehicleRow = {
  id: string;
  name: string;
  active: boolean | null;
  created_at: string;
  minseats: number;
  maxseats: number;
  minvalue: number;
  description: string;
  picture_url: string | null;
  min_val_threshold: number | null;
  type_id: string | null;     // journey_types.id
  operator_id: string | null; // operators.id
};

/* ---------- Small helpers ---------- */
const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

export default function OperatorVehiclesIndex() {
  /* Safe Supabase client */
  const sb: SupabaseClient | null = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createBrowserClient(url, key);
  })();
  if (!sb) return null;

  /* ps_user (locks operator for operator admins) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u || null);
      if (u?.operator_admin && u.operator_id) setOperatorId(u.operator_id);
    } catch { /* ignore */ }
  }, []);

  const lockedOperatorName =
    (operatorLocked && psUser?.operator_name) ||
    "";

  /* Lookups + rows */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Filters / UI */
  const [operatorId, setOperatorId] = useState("");
  const [q, setQ] = useState("");

  /* Thumbs (signed or public) */
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  async function signedUrl(pathOrUrl: string | null): Promise<string | null> {
    if (!pathOrUrl) return null;
    if (isHttp(pathOrUrl)) return pathOrUrl;
    // public first
    const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
    if (pub) return pub;
    const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
    return data?.signedUrl ?? null;
  }

  /* Initial load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, rels, vs] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb
          .from("vehicles")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (ops.error || jts.error || rels.error || vs.error) {
        setMsg(
          ops.error?.message ||
            jts.error?.message ||
            rels.error?.message ||
            vs.error?.message ||
            "Load failed"
        );
      }

      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setOpTypeRels((rels.data as OperatorTypeRel[]) || []);
      setRows((vs.data as VehicleRow[]) || []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Resolve thumbnails when rows change */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await signedUrl(r.picture_url)] as const)
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const operatorName = (id: string | null | undefined) =>
    operators.find((o) => o.id === id)?.name ?? "—";
  const typeName = (id: string | null | undefined) =>
    journeyTypes.find((t) => t.id === id)?.name ?? "—";

  /* Text + operator filter */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = operatorId ? rows.filter(r => (r.operator_id ?? "") === operatorId) : rows;
    if (!s) return base;
    return base.filter(r =>
      r.name.toLowerCase().includes(s) ||
      operatorName(r.operator_id).toLowerCase().includes(s) ||
      typeName(r.type_id).toLowerCase().includes(s)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, operatorId, operators.length, journeyTypes.length]);

  /* Allowed types for the selected operator (used only to display subtitle) */
  const allowedTypeIdsForOperator = useMemo(
    () => new Set(opTypeRels.filter(r => r.operator_id === operatorId).map(r => r.journey_type_id)),
    [opTypeRels, operatorId]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Vehicles</h1>
        <p className="text-neutral-600">
          {operatorLocked
            ? <>Showing vehicles for <strong>{lockedOperatorName || psUser?.operator_id}</strong>.</>
            : "Pick an Operator (or All) and click a tile to edit."}
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {operatorLocked ? (
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            {lockedOperatorName || psUser?.operator_id}
          </div>
        ) : (
          <select
            className="border rounded-lg px-3 py-2"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
          >
            <option value="">All Operators</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        <input
          className="border rounded-lg px-3 py-2"
          placeholder="Search vehicles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Link
          href="/operator-admin/vehicles/edit/new"
          className="ml-auto inline-flex items-center rounded-full px-4 py-2 bg-black text-white text-sm"
        >
          New Vehicle
        </Link>
      </div>

      {/* Tiles */}
      <section>
        {loading ? (
          <div className="p-4 rounded-2xl border bg-white shadow">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 rounded-2xl border bg-white shadow">No vehicles found.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <Link
                key={r.id}
                href={`/operator-admin/vehicles/edit/${r.id}`}
                className="block rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
              >
                {/* Image */}
                <div className="relative">
                  {thumbs[r.id] ? (
                    <img
                      src={thumbs[r.id]!}
                      alt={r.name}
                      className="w-full h-44 sm:h-52 object-cover"
                    />
                  ) : (
                    <div className="w-full h-44 sm:h-52 grid place-items-center bg-neutral-100 text-neutral-400">
                      No image
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-3">
                  <div className="flex items-start gap-2">
                    <h3 className="font-medium leading-tight">{r.name}</h3>
                    <span
                      className={cls(
                        "ml-auto text-xs px-2 py-[2px] rounded-full border",
                        (r.active ?? true)
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-neutral-100 text-neutral-600"
                      )}
                    >
                      {(r.active ?? true) ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">
                    {operatorName(r.operator_id)} • {typeName(r.type_id)}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Seats {r.minseats}–{r.maxseats} • Min £{r.minvalue}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
