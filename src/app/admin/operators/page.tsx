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
type Country = { id: string; name: string };
type JourneyType = { id: string; name: string };
type OperatorRow = {
  id: string;
  name: string | null;
  admin_email: string | null;
  phone: string | null;
  created_at: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  country_id: string | null;
  /** STORAGE PATH, e.g. images/operators/<id>/<file>.jpg */
  logo_url: string | null;
};
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

/* ---------- Storage helpers ---------- */
const STORAGE_BUCKET = "images";
function isHttpUrl(s: string | null | undefined) {
  return !!s && /^https?:\/\//i.test(s);
}
async function resolveLogoUrl(pathOrUrl: string): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365); // 1 year
  if (error) return null;
  return data?.signedUrl ?? null;
}

export default function OperatorsIndexPage() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<OperatorRow[]>([]);
  const [rels, setRels] = useState<OperatorTypeRel[]>([]);
  const [logoUrlMap, setLogoUrlMap] = useState<Record<string, string | null>>({});

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  /* Initial load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, jt, ops, ot] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operators").select("*").order("created_at", { ascending: false }),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);
      if (off) return;
      if (c.error || jt.error || ops.error || ot.error) {
        setMsg(
          c.error?.message ||
            jt.error?.message ||
            ops.error?.message ||
            ot.error?.message ||
            "Load failed"
        );
      }
      setCountries((c.data as Country[]) || []);
      setJourneyTypes((jt.data as JourneyType[]) || []);
      const rows = (ops.data as OperatorRow[]) || [];
      setRows(rows);
      setRels((ot.data as OperatorTypeRel[]) || []);
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  /* Resolve logos */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, r.logo_url ? await resolveLogoUrl(r.logo_url) : null] as const)
      );
      if (!cancelled) setLogoUrlMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [rows]);

  const countryName = (id: string | null | undefined) =>
    countries.find((c) => c.id === id)?.name ?? "—";

  const servicesFor = (opId: string) =>
    rels
      .filter((r) => r.operator_id === opId)
      .map((r) => journeyTypes.find((jt) => jt.id === r.journey_type_id)?.name)
      .filter(Boolean)
      .join(", ") || "—";

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.name || "").toLowerCase().includes(s) ||
      (r.admin_email || "").toLowerCase().includes(s) ||
      (r.phone || "").toLowerCase().includes(s) ||
      countryName(r.country_id).toLowerCase().includes(s) ||
      servicesFor(r.id).toLowerCase().includes(s)
    );
  }, [rows, q, countries, rels, journeyTypes]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Admin • Operators</h1>
        <div className="ml-auto flex gap-2">
          <input
            className="border rounded-lg px-3 py-2 w-72 max-w-full"
            placeholder="Search operators…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Link
            href="/admin/operators/edit/new"
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90"
          >
            New Operator
          </Link>
        </div>
      </header>

      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {/* Tiled cards */}
      {loading ? (
        <div className="rounded-2xl border bg-white p-4">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border bg-white p-4">No operators yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* New tile (also at top) */}
          <Link
            href="/admin/operators/edit/new"
            className="rounded-2xl border border-dashed bg-white hover:shadow transition flex items-center justify-center h-60"
          >
            <span className="text-blue-600 font-medium">+ New Operator</span>
          </Link>

          {filtered.map((r) => {
            const logo = logoUrlMap[r.id] || null;
            return (
              <Link
                key={r.id}
                href={`/admin/operators/edit/${r.id}`}
                className="group rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow transition"
                title="Edit operator"
              >
                <div className="h-40 w-full overflow-hidden bg-neutral-50 flex items-center justify-center">
                  {logo ? (
                    <img src={logo} alt={r.name || "logo"} className="h-full w-full object-cover" />
                  ) : (
                    <div className="text-sm text-neutral-500">No logo</div>
                  )}
                </div>
                <div className="p-3 space-y-1">
                  <div className="font-medium leading-tight">{r.name || "—"}</div>
                  <div className="text-xs text-neutral-600">
                    {countryName(r.country_id)}
                  </div>
                  <div className="text-xs text-neutral-600 line-clamp-2">
                    {servicesFor(r.id)}
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
