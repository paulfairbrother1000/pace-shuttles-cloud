// src/app/operator-admin/staff/StaffTilesClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Small helper to render staff tile images ---------- */
function StaffTileImage({ src, alt }: { src: string; alt: string }) {
  const [objPos, setObjPos] = useState<"50% 50%" | "50% 20%" | "50% 8%">("50% 50%");

  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-44 sm:h-52 rounded-t-2xl object-cover"
      style={{ objectPosition: objPos }}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (h > w * 1.35) setObjPos("50% 8%");
        else if (h > w * 1.05) setObjPos("50% 20%");
        else setObjPos("50% 50%");
      }}
    />
  );
}

/* ---------- Supabase (browser) ---------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  first_name?: string | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  site_admin?: boolean | null;
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
  type_ids: string[] | null;
  pronoun: "he" | "she" | "they" | null;
};

const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  if (!sb) return null;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export default function StaffTilesClient() {
  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Which operator to view (site admin can choose) */
  const [operatorId, setOperatorId] = useState("");

  /* thumbs */
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  /* search */
  const [q, setQ] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      if (!sb) {
        setMsg("Supabase client not configured.");
        setLoading(false);
        return;
      }
      const [ops, types, staff] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_staff").select("*").order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (ops.data) setOperators(ops.data as Operator[]);
      if (types.data) setJourneyTypes(types.data as JourneyType[]);
      if (staff.error) setMsg(staff.error.message);
      setRows((staff.data as StaffRow[]) || []);

      if (isOpAdmin && psUser?.operator_id) setOperatorId(psUser.operator_id);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, [isOpAdmin, psUser?.operator_id]);

  /* thumbs */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolveStorageUrl(r.photo_url || null)] as const)
      );
      if (!cancelled) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const operatorName = (id: string | null | undefined) =>
    (id && operators.find((o) => o.id === id)?.name) || "";

  const typesList = (row: StaffRow) =>
    (row.type_ids && row.type_ids.length
      ? row.type_ids.map((id) => journeyTypes.find((t) => t.id === id)?.name).filter(Boolean)
      : [journeyTypes.find((t) => t.id === row.type_id)?.name]
    )
      .filter(Boolean)
      .join(", ");

  /* filter by operator + search */
  const filtered = useMemo(() => {
    const base = operatorId ? rows.filter((r) => r.operator_id === operatorId) : rows;
    const s = q.trim().toLowerCase();
    if (!s) return base;
    return base.filter(
      (r) =>
        `${r.first_name} ${r.last_name}`.toLowerCase().includes(s) ||
        (r.jobrole || "").toLowerCase().includes(s) ||
        typesList(r).toLowerCase().includes(s) ||
        operatorName(r.operator_id).toLowerCase().includes(s)
    );
  }, [rows, q, operatorId, journeyTypes]);

  const lockedOperatorName =
    isOpAdmin && psUser?.operator_id
      ? psUser?.operator_name || operatorName(psUser.operator_id) || psUser.operator_id
      : "";

  return (
    <div className="space-y-6 p-4">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Staff</h1>
          <p className="text-neutral-600">
            {isOpAdmin ? (
              <>Showing staff for <strong>{lockedOperatorName}</strong>.</>
            ) : (
              "Choose an Operator to view their staff, or All to see everything."
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isOpAdmin && (
            <select
              className="border rounded-full px-3 py-2"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="">All Operators</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}

          <input
            className="border rounded-full px-3 py-2"
            placeholder="Search staff…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <Link
            href="/operator-admin/staff/edit/new"
            className="rounded-full px-4 py-2 bg-black text-white text-sm"
          >
            New Staff
          </Link>
        </div>
      </header>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/operator-admin/staff/edit/new"
          className="rounded-2xl border bg-white shadow hover:shadow-md transition overflow-hidden grid place-items-center aspect-[16/10]"
        >
          <span className="text-blue-600">+ New Staff</span>
        </Link>

        {loading ? (
          <div className="col-span-full p-4">Loading…</div>
        ) : operatorId && filtered.length === 0 ? (
          <div className="col-span-full p-4">No staff yet for this operator.</div>
        ) : !operatorId && !isOpAdmin && rows.length === 0 ? (
          <div className="col-span-full p-4">No staff yet.</div>
        ) : (
          filtered.map((r) => (
            <Link
              key={r.id}
              href={`/operator-admin/staff/edit/${r.id}`}
              className="rounded-2xl border bg-white overflow-hidden shadow hover:shadow-md transition"
            >
              <div className="h-40 w-full bg-neutral-100 overflow-hidden grid place-items-center">
                {thumbs[r.id] ? (
                  <StaffTileImage src={thumbs[r.id] ?? ""} alt={`${r.first_name} ${r.last_name}`} />
                ) : (
                  <span className="text-neutral-400 text-sm">No image</span>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium">
                  {r.first_name} {r.last_name}
                </div>
                <div className="text-xs text-neutral-600">
                  {operatorName(r.operator_id)} • {typesList(r) || "—"}
                </div>
                <div className="text-xs text-neutral-600">{r.jobrole || "—"}</div>
                <div className="mt-2">
                  <span
                    className={cls(
                      "inline-block text-xs px-2 py-0.5 rounded-full border",
                      (r.status || "Active") === "Active"
                        ? "border-green-500 text-green-700"
                        : "border-neutral-300 text-neutral-500"
                    )}
                  >
                    {(r.status || "Active") === "Active" ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
