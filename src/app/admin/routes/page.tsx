"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

/* Supabase */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* Types */
type UUID = string;
type PsUser = {
  id: UUID;
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: UUID; name: string };
type JourneyType = { id: UUID; name: string };

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
  journey_type_id: string | null; // ← aligned to schema
};

type OperatorTypeRel = { operator_id: UUID; journey_type_id: UUID };

const ALL = "__ALL__";

export default function AdminRoutesPage() {
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [types, setTypes] = useState<JourneyType[]>([]);
  const [rels, setRels] = useState<OperatorTypeRel[]>([]);
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [operatorId, setOperatorId] = useState<string>("");

  const isSiteAdmin = Boolean(psUser?.site_admin);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id && !isSiteAdmin);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.site_admin) setOperatorId(ALL);
      else if (u?.operator_admin && u.operator_id) setOperatorId(u.operator_id);
      else setOperatorId(ALL);
    } catch {
      setPsUser(null);
      setOperatorId(ALL);
    }
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const [opsQ, typesQ, relsQ, routesQ] = await Promise.all([
          sb.from("operators").select("id,name").order("name"),
          sb.from("journey_types").select("id,name").order("name"),
          sb.from("operator_transport_types").select("operator_id,journey_type_id"),
          sb
            .from("routes")
            .select(`
              id, route_name, name, frequency, journey_type_id,
              pickup:pickup_id ( name, picture_url ),
              destination:destination_id ( name, picture_url )
            `)
            .eq("is_active", true)
            .order("created_at", { ascending: false }),
        ]);
        if (opsQ.error) throw opsQ.error;
        if (typesQ.error) throw typesQ.error;
        if (relsQ.error) throw relsQ.error;
        if (routesQ.error) throw routesQ.error;

        if (off) return;
        setOperators((opsQ.data || []) as Operator[]);
        setTypes((typesQ.data || []) as JourneyType[]);
        setRels((relsQ.data || []) as OperatorTypeRel[]);

        const mapped: RouteRow[] = (routesQ.data as any[]).map((r) => ({
          id: r.id,
          route_name: r.route_name ?? null,
          name: r.name ?? null,
          frequency: r.frequency ?? null,
          journey_type_id: r.journey_type_id ?? null,
          pickup: r.pickup ? { name: r.pickup.name, picture_url: r.pickup.picture_url } : null,
          destination: r.destination ? { name: r.destination.name, picture_url: r.destination.picture_url } : null,
        }));
        setRows(mapped);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  const jtName = (id: string | null) =>
    types.find((t) => t.id === id)?.name ?? "—";

  const allowedTypeIds = useMemo(() => {
    if (!operatorId || operatorId === ALL) return new Set<string>();
    return new Set(rels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id));
  }, [rels, operatorId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let base = rows;

    if (operatorId && operatorId !== ALL) {
      base = base.filter((r) => r.journey_type_id && allowedTypeIds.has(r.journey_type_id));
    }
    if (!s) return base;

    return base.filter((r) =>
      `${r.route_name || r.name || ""} ${r.pickup?.name || ""} ${r.destination?.name || ""}`
        .toLowerCase()
        .includes(s)
    );
  }, [rows, q, operatorId, allowedTypeIds]);

  const canCreate = isSiteAdmin && operatorId && operatorId !== ALL;
  const opCtx = isSiteAdmin ? (operatorId === ALL ? "" : operatorId) : psUser?.operator_id || "";

  function goNew() {
    if (!canCreate) {
      alert("Select a specific operator to create a route (Site Admin only).");
      return;
    }
    window.location.href = `/admin/routes/edit/new?op=${encodeURIComponent(opCtx!)}`;
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-5">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin • Routes</h1>
          <p className="text-neutral-600 text-sm">
            {isSiteAdmin ? "Select an operator to create/edit routes." : "Read-only (Operator Admin)."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isOpAdmin ? (
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              title="Filter by operator"
            >
              <option value={ALL}>All operators</option>
              <option value="">— Select —</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {psUser?.operator_name || psUser?.operator_id}
            </div>
          )}

          <input
            className="border rounded-lg px-3 py-2 text-sm w-64"
            placeholder="Search routes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            className="rounded-full px-4 py-2 text-white text-sm disabled:opacity-50"
            style={{ backgroundColor: "#2563eb" }}
            onClick={goNew}
            disabled={!canCreate}
            title={canCreate ? "Create a new route" : "Select an operator (Site Admin only)"}
          >
            New route
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      <section>
        {loading ? (
          <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 border rounded-xl bg-white shadow">No routes found.</div>
        ) : (
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {/* Optional “New” tile for parity with other admin pages */}
            {isSiteAdmin && (
              <button
                onClick={goNew}
                className="h-[260px] rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition overflow-hidden flex items-center justify-center disabled:opacity-50"
                disabled={!canCreate}
                title={canCreate ? "Create a new route" : "Select an operator first"}
              >
                <span className="text-blue-600 font-medium">+ New Route</span>
              </button>
            )}

            {filtered.map((r) => {
              const pImg = publicImage(r.pickup?.picture_url) || "";
              const dImg = publicImage(r.destination?.picture_url) || "";
              const line = `${r.pickup?.name ?? "—"} → ${r.destination?.name ?? "—"}`;
              const tName = jtName(r.journey_type_id);

              return (
                <article
                  key={r.id}
                  className="rounded-2xl border border-neutral-200 bg-white shadow hover:shadow-md transition overflow-hidden cursor-pointer"
                  onClick={() =>
                    (window.location.href = `/admin/routes/edit/${r.id}?op=${encodeURIComponent(opCtx || "")}`)
                  }
                  title={isSiteAdmin ? "Edit route" : "View route"}
                >
                  <div className="grid grid-cols-2 h-[150px] w-full overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pImg || "/placeholder.png"} alt="Pickup" className="w-full h-full object-cover" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={dImg || "/placeholder.png"} alt="Destination" className="w-full h-full object-cover" />
                  </div>

                  <div className="p-3">
                    <div className="font-medium">{line}</div>
                    <div className="text-xs text-neutral-600">
                      {(r.route_name || r.name || "").trim() || line}
                    </div>
                    <div className="mt-2 flex gap-2 items-center">
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-neutral-300 text-neutral-600">
                        {r.frequency || "—"}
                      </span>
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-blue-300 text-blue-700">
                        {tName}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
