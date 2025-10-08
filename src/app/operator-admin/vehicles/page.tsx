"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

/* ---------- Supabase (browser) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  type_id: string | null;      // journey_types.id
  operator_id: string | null;  // operators.id
};

/* ---------- Small helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function signedUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}
function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

/* Adaptive image (bias to top for portrait shots) */
function VehicleTileImage({ src, alt }: { src: string; alt: string }) {
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

export default function VehiclesTilesPage() {
  const router = useRouter();

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.operator_admin && u.operator_id) {
        setOperatorId((cur) => cur || u.operator_id!);
      }
    } catch {
      setPsUser(null);
    }
  }, []);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* Lookups + rows */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* UI */
  const [operatorId, setOperatorId] = useState(""); // empty = All (site admin only)
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  /* Thumbs map */
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  /* Load data */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, vs] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("vehicles")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (ops.error || jts.error || vs.error) {
        setMsg(ops.error?.message || jts.error?.message || vs.error?.message || "Load failed");
      }
      const vrows = (vs.data as VehicleRow[]) || [];
      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setRows(vrows);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Resolve thumbs */
  useEffect(() => {
    let off = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await signedUrl(r.picture_url)] as const)
      );
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      off = true;
    };
  }, [rows]);

  /* Filter rows by operator + text */
  const filtered = useMemo(() => {
    const base = operatorLocked
      ? rows.filter((r) => r.operator_id === psUser?.operator_id)
      : operatorId
      ? rows.filter((r) => r.operator_id === operatorId)
      : rows; // site admin, "All"

    const s = q.trim().toLowerCase();
    if (!s) return base;

    const typeName = (id: string | null) => journeyTypes.find((t) => t.id === id)?.name ?? "";
    const opName = (id: string | null) => operators.find((o) => o.id === id)?.name ?? "";

    return base.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        typeName(r.type_id).toLowerCase().includes(s) ||
        opName(r.operator_id).toLowerCase().includes(s)
    );
  }, [rows, q, operatorId, operatorLocked, psUser?.operator_id, journeyTypes, operators]);

  const lockedOperatorName =
    (operatorLocked && (psUser?.operator_name || operators.find((o) => o.id === psUser!.operator_id!)?.name)) || "";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vehicles</h1>
          <p className="text-neutral-600">
            {operatorLocked ? (
              <>Showing vehicles for <strong>{lockedOperatorName || psUser?.operator_id}</strong>.</>
            ) : (
              <>Pick an operator to filter, or choose “All”.</>
            )}
          </p>
          {msg && <p className="text-sm text-red-600 mt-1">{msg}</p>}
        </div>

        <div className="flex gap-2">
          {!operatorLocked ? (
            <select
              className="border rounded-full px-3 py-2 text-sm"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              title="Filter by operator"
            >
              <option value="">All operators</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {lockedOperatorName || psUser?.operator_id}
            </span>
          )}

          <input
            className="border rounded-full px-3 py-2 text-sm"
            placeholder="Search vehicles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </header>

      {/* Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* New tile */}
        <button
          onClick={() => router.push("/operator-admin/vehicles/edit/new")}
          className="rounded-2xl border-2 border-dashed border-neutral-300 hover:border-neutral-400 transition p-6 flex items-center justify-center text-neutral-500"
        >
          + New Vehicle
        </button>

        {/* Vehicle tiles */}
        {loading ? (
          <div className="col-span-full p-4">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-4">No vehicles found.</div>
        ) : (
          filtered.map((r) => {
            const typeName = journeyTypes.find((t) => t.id === r.type_id)?.name ?? "—";
            const opName =
              operatorLocked
                ? lockedOperatorName || "—"
                : operators.find((o) => o.id === r.operator_id)?.name ?? "—";
            return (
              <div
                key={r.id}
                className="rounded-2xl overflow-hidden border bg-white shadow hover:shadow-md transition"
              >
                {thumbs[r.id] ? (
                  <VehicleTileImage src={thumbs[r.id]!} alt={r.name} />
                ) : (
                  <div className="w-full h-44 sm:h-52 rounded-t-2xl bg-neutral-100 flex items-center justify-center text-neutral-400">
                    No image
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-sm text-neutral-600 truncate">
                        {opName} • {typeName}
                      </div>
                      <div className="text-xs text-neutral-500">
                        Seats {r.minseats}–{r.maxseats} • Min £{r.minvalue}
                      </div>
                    </div>
                    <span
                      className={cls(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs border",
                        (r.active ?? true)
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-neutral-50 text-neutral-600 border-neutral-200"
                      )}
                    >
                      {(r.active ?? true) ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      className="rounded-full border px-3 py-1 text-sm"
                      onClick={() => router.push(`/operator-admin/vehicles/edit/${r.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-full border px-3 py-1 text-sm"
                      onClick={() => router.push(`/operator-admin/vehicles/edit/${r.id}#delete`)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
