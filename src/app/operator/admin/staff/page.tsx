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
type PsUser = {
  id: string;
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string };
type JourneyType = { id: string; name: string };
type StaffRow = {
  id: string;
  operator_id: string;
  first_name: string;
  last_name: string;
  status: string | null;
  photo_url: string | null;
  licenses: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  jobrole: string | null;
  type_id: string | null;
};

/* ---------- Image helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function StaffIndexPage() {
  /* Current user (from localStorage) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);
  const isSiteAdmin = Boolean(psUser?.site_admin);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);

  /* Lookups + rows */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* UI */
  const [q, setQ] = useState("");
  const [operatorFilter, setOperatorFilter] = useState<string>("");

  const typeName = (id?: string | null) =>
    journeyTypes.find((t) => t.id === id)?.name ?? "—";
  const opName = (id?: string | null) =>
    operators.find((o) => o.id === id)?.name ?? "—";

  /* Load data */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, staff] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_staff").select("*").order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (ops.error || jts.error || staff.error) {
        setMsg(
          ops.error?.message ||
            jts.error?.message ||
            staff.error?.message ||
            "Load failed"
        );
      }
      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setRows((staff.data as StaffRow[]) || []);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Thumbnails */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolveStorageUrl(r.photo_url)] as const)
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [rows]);

  /* Effective operator filter when operator-admin */
  useEffect(() => {
    if (isOpAdmin && psUser?.operator_id) setOperatorFilter(psUser.operator_id);
  }, [isOpAdmin, psUser?.operator_id]);

  /* Filter + search */
  const filtered = useMemo(() => {
    const byOp = operatorFilter ? rows.filter((r) => r.operator_id === operatorFilter) : rows;
    const s = q.trim().toLowerCase();
    if (!s) return byOp;
    return byOp.filter(
      (r) =>
        r.first_name.toLowerCase().includes(s) ||
        r.last_name.toLowerCase().includes(s) ||
        (r.jobrole || "").toLowerCase().includes(s) ||
        typeName(r.type_id).toLowerCase().includes(s) ||
        opName(r.operator_id).toLowerCase().includes(s)
    );
  }, [rows, q, operatorFilter, operators, journeyTypes]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Operator • Staff</h1>

        <div className="ml-auto flex gap-2">
          {/* Site admin can choose operator; op-admin is locked */}
          {isOpAdmin ? (
            <div className="rounded-full border px-3 py-2 text-sm bg-neutral-50">
              {psUser?.operator_name ?? psUser?.operator_id}
            </div>
          ) : (
            <select
              className="border rounded-lg px-3 py-2"
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
            >
              <option value="">All operators</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}

          <input
            className="border rounded-lg px-3 py-2 w-56 max-w-full"
            placeholder="Search staff…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Link
            href="/operator-admin/staff/edit/new"
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90"
          >
            New Staff
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
        <div className="rounded-2xl border bg-white p-4">No staff.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* New tile */}
          <Link
            href="/operator-admin/staff/edit/new"
            className="rounded-2xl border border-dashed bg-white hover:shadow transition flex items-center justify-center h-64"
          >
            <span className="text-blue-600 font-medium">+ New Staff</span>
          </Link>

          {filtered.map((s) => (
            <Link
              key={s.id}
              href={`/operator-admin/staff/edit/${s.id}`}
              className="group rounded-2xl border bg-white overflow-hidden shadow-sm hover:shadow transition"
              title="Edit staff"
            >
              <div className="h-40 w-full overflow-hidden bg-neutral-50">
                {thumbs[s.id] ? (
                  <img src={thumbs[s.id]!} alt={`${s.first_name} ${s.last_name}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm text-neutral-500">
                    No image
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="font-medium leading-tight">
                  {s.first_name} {s.last_name}
                </div>
                <div className="text-xs text-neutral-600">
                  {opName(s.operator_id)} • {typeName(s.type_id)}
                </div>
                <div className="text-xs text-neutral-600">{s.jobrole || "—"}</div>
                <div className="text-[11px]">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-[2px] border ${
                      (s.status || "Active") === "Active"
                        ? "border-green-600 text-green-700"
                        : "border-neutral-400 text-neutral-600"
                    }`}
                  >
                    {(s.status || "Active") === "Active" ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
