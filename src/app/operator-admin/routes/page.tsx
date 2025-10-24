// src/app/operator-admin/routes/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type UUID = string;

type PsUser = {
  id: UUID;
  first_name?: string | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: UUID; name: string };

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  frequency: string | null;
  pickup?: { name: string; picture_url: string | null } | null;
  destination?: { name: string; picture_url: string | null } | null;
  journey_type_id: string | null;
};

type OperatorTypeRel = { operator_id: UUID; journey_type_id: UUID };

/* ---------- SAME public-image helper used elsewhere ---------- */
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
      return raw; // already a normal absolute URL
    } catch {
      /* ignore */
    }
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

export default function OperatorRoutesTilesPage() {
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

  const [operators, setOperators] = useState<Operator[]>([]);
  const [operatorId, setOperatorId] = useState<string>("");

  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // read ps_user and pre-select operator for operator admins
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

  // initial lookups + routes
  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) return;
      setLoading(true);

      const [ops, rels, r] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb
          .from("routes")
          .select(
            `
            id,
            route_name,
            name,
            frequency,
            journey_type_id,
            pickup:pickup_id ( name, picture_url ),
            destination:destination_id ( name, picture_url )
          `
          )
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
      ]);

      if (off) return;

      if (ops.data) setOperators((ops.data as Operator[]) || []);
      if (rels.data) setOpTypeRels((rels.data as OperatorTypeRel[]) || []);

      if (r.data) {
        const rows: RouteRow[] = ((r.data as any[]) || []).map((row) => ({
          id: row.id,
          route_name: row.route_name ?? null,
          name: row.name ?? null,
          frequency: row.frequency ?? null,
          journey_type_id: row.journey_type_id ?? null,
          pickup: row.pickup
            ? { name: row.pickup.name as string, picture_url: row.pickup.picture_url as string | null }
            : null,
          destination: row.destination
            ? { name: row.destination.name as string, picture_url: row.destination.picture_url as string | null }
            : null,
        }));
        setRoutes(rows);
      }

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  // which journey types are allowed for current operator?
  const allowedTypeIds = useMemo(() => {
    if (!operatorId) return new Set<string>();
    return new Set(opTypeRels.filter(r => r.operator_id === operatorId).map(r => r.journey_type_id));
  }, [opTypeRels, operatorId]);

  // filter by operator's allowed journey types + search
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    // If operator is selected (or locked), only show routes whose journey_type_id
    // is allowed for that operator. (If a route has null journey_type_id, hide it.)
    const base = operatorId
      ? routes.filter(r => r.journey_type_id && allowedTypeIds.has(r.journey_type_id))
      : routes;

    if (!s) return base;
    return base.filter((r) =>
      `${r.route_name || r.name || ""} ${r.pickup?.name || ""} ${r.destination?.name || ""}`
        .toLowerCase()
        .includes(s)
    );
  }, [routes, q, operatorId, allowedTypeIds]);

  const lockedOperatorName =
    isOpAdmin && psUser?.operator_id
      ? psUser?.operator_name ||
        operators.find((o) => o.id === psUser.operator_id)?.name ||
        psUser.operator_id
      : "";

  // NEW: determine create URL & enabled state
  const effectiveOp = isOpAdmin ? (psUser?.operator_id || "") : operatorId;
  const canCreate = Boolean(effectiveOp);

  return (
    <div className="p-4 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="text-sm">Operator</div>
          {isOpAdmin ? (
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              {lockedOperatorName || psUser?.operator_id}
            </div>
          ) : (
            <select
              className="border rounded-full px-3 py-2"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
            >
              <option value="">— Select —</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            className="border rounded-full px-3 py-2"
            placeholder="Search routes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* NEW: Create button (enabled when an operator context exists) */}
          <Link
            href={
              canCreate
                ? `/operator-admin/routes/edit/new?op=${encodeURIComponent(effectiveOp)}`
                : "#"
            }
            className={`rounded-full px-3 py-2 text-sm ${
              canCreate
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-neutral-300 text-neutral-600 cursor-not-allowed pointer-events-none"
            }`}
          >
            New route
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full p-4">Loading…</div>
        ) : !operatorId && !isOpAdmin ? (
          <div className="col-span-full p-4">Choose an Operator to manage assignments.</div>
        ) : filtered.length === 0 ? (
          <div className="col-span-full p-4">No routes.</div>
        ) : (
          filtered.map((r) => {
            const pImg = publicImage(r.pickup?.picture_url);
            const dImg = publicImage(r.destination?.picture_url);

            // ✅ Link back to the existing detail page path; pass op so edit locks operator
            const effectiveOp = isOpAdmin ? (psUser?.operator_id || "") : operatorId;
            const href = `/operator-admin/routes/edit/${r.id}?op=${encodeURIComponent(effectiveOp)}`;

            return (
              <Link
                key={r.id}
                href={href}
                className="rounded-2xl border bg-white shadow hover:shadow-md transition overflow-hidden"
              >
                {/* Two images area */}
                <div className="relative w-full aspect-[16/7] grid grid-cols-2">
                  <div className="relative">
                    {pImg ? (
                      <Image src={pImg} alt={r.pickup?.name || "Pickup"} fill unoptimized className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-neutral-100" />
                    )}
                  </div>
                  <div className="relative">
                    {dImg ? (
                      <Image
                        src={dImg}
                        alt={r.destination?.name || "Destination"}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-neutral-100" />
                    )}
                  </div>
                </div>

                <div className="p-3">
                  <div className="font-medium">
                    {r.pickup?.name ?? "—"} → {r.destination?.name ?? "—"}
                  </div>
                  <div className="text-xs text-neutral-600">
                    {(r.route_name || r.name || "").trim() ||
                      `${r.pickup?.name ?? ""} • ${r.destination?.name ?? ""}`}
                  </div>
                  <div className="mt-2">
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-neutral-300 text-neutral-600">
                      {r.frequency || "—"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
