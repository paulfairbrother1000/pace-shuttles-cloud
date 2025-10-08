"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
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
  picture_url: string | null; // storage path or full URL
  min_val_threshold: number | null;
  type_id: string | null;
  operator_id: string | null;
};

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolvePic(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function VehiclesIndexPage() {
  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* Data */
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* UI */
  const [q, setQ] = useState("");
  const [operatorFilter, setOperatorFilter] = useState<string>("");

  const operatorName = (id?: string | null) =>
    operators.find((o) => o.id === id)?.name ?? "—";
  const typeName = (id?: string | null) =>
    journeyTypes.find((t) => t.id === id)?.name ?? "—";

  /* Load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, rels, vs] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb.from("vehicles").select("*").order("created_at", { ascending: false }),
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
    return () => { off = true; };
  }, []);

  /* Resolve thumbnails */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolvePic(r.picture_url)] as const)
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [rows]);

  /* Filter */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let base = rows;
    if (operatorFilter) base = base.filter((r) => r.operator_id === operatorFilter);
    if (!s) return base;
    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        operatorName(r.operator_id).toLowerCase().includes(s) ||
        typeName(r.type_id).toLowerCase().includes(s)
    );
  }, [rows, q, operatorFilter, operators, journeyTypes]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Vehicles</h1>
        <div className="ml-auto flex gap-2">
          <select
            className="border rounded-lg px-3 py-2"
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value)}
          >
            <option value="">All operators</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            className="border rounded-lg px-3 py-2 w-64 max-w-full"
            placeholder="Search vehicles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Link
            href="/admin/vehicles/edit/new"
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90"
          >
            New Vehicle
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
        <div className="rounded-2xl border bg-white p-4">No vehicles.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* New tile */}
          <Link
            href="/admin/vehicles/edit/new"
            className="rounded-2xl border border-dashed bg-white hover:shadow transition flex items-center justify-center h-64"
          >
            <span className="text-blue-600 font-medium">+ New Vehicle</span>
          </Link>

          {filtered.map((v) => (
            <Link
              key={v.id}
              href={`/admin/vehicles/edit/${v.id}`}
              className="group rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow transition"
              title="Edit vehicle"
            >
              <div className="h-40 w-full overflow-hidden bg-neutral-50">
                {thumbs[v.id] ? (
                  <img src={thumbs[v.id]!} alt={v.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm text-neutral-500">
                    No image
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="font-medium leading-tight">{v.name}</div>
                <div className="text-xs text-neutral-600">
                  {operatorName(v.operator_id)} • {typeName(v.type_id)}
                </div>
                <div className="text-xs text-neutral-600">
                  Seats {v.minseats}–{v.maxseats} • Min £{v.minvalue}
                </div>
                <div className="text-[11px]">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-[2px] border ${
                      (v.active ?? true)
                        ? "border-green-600 text-green-700"
                        : "border-neutral-400 text-neutral-600"
                    }`}
                  >
                    {(v.active ?? true) ? "Active" : "Hidden"}
                  </span>
                </div>
                {v.description && (
                  <div className="text-xs text-neutral-600 line-clamp-2">{v.description}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
