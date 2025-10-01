"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useSearchParams } from "next/navigation";

type UUID = string;

/* ---------- Supabase (browser) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Operator = { id: UUID; name: string; active?: boolean | null };

type JourneyType = { id: UUID; name: string };
type TransportType = { id: UUID; name: string };

type Pickup = { id: UUID; name: string; picture_url: string | null };
type Destination = { id: UUID; name: string; picture_url: string | null };

type Vehicle = {
  id: UUID;
  name: string;
  active: boolean;
  operator_id: UUID | null;
  type_id: UUID | null; // links to transport_types.id
  minseats: number;
  maxseats: number;
};

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  pickup_id: UUID | null;
  destination_id: UUID | null;
  frequency: string | null;
  is_active: boolean | null;

  // type fields
  journey_type_id: UUID | null; // references journey_types.id
  transport_type: string | null; // legacy label text
};

/* ---------- Page ---------- */
export default function OperatorAdminRoutesPage() {
  const searchParams = useSearchParams();
  const operatorIdFromQS = searchParams.get("operatorId");

  // lookups & data
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);

  // ui state
  const [opId, setOpId] = useState<UUID | "">("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  /* ---------- Helpers ---------- */
  const journeyTypeName = (id: UUID | null | undefined) =>
    (id && journeyTypes.find((t) => t.id === id)?.name) || "—";

  const transportTypeName = (id: UUID | null | undefined) =>
    (id && transportTypes.find((t) => t.id === id)?.name) || "";

  const pickupById = (id: UUID | null | undefined) =>
    (id && pickups.find((p) => p.id === id)) || null;

  const destById = (id: UUID | null | undefined) =>
    (id && destinations.find((d) => d.id === id)) || null;

  // Normalised label for a route (e.g., "bus", "helicopter", "speed boat")
  const labelForRoute = (r: RouteRow) => {
    const jt = journeyTypeName(r.journey_type_id);
    const label = jt !== "—" ? jt : (r.transport_type ?? "");
    return (label || "").toLowerCase().trim();
  };

  /* ---------- Load all lookups & data ---------- */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, tts, pus, des, vhs, rts] = await Promise.all([
        sb.from("operators").select("id,name,active").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("transport_types").select("id,name").order("name"),
        sb.from("pickup_points").select("id,name,picture_url").order("name"),
        sb.from("destinations").select("id,name,picture_url").order("name"),
        sb
          .from("vehicles")
          .select("id,name,active,operator_id,type_id,minseats,maxseats")
          .order("name"),
        sb.from("routes").select("*").order("created_at", { ascending: false }),
      ]);

      if (off) return;

      if (ops.error || jts.error || tts.error || pus.error || des.error || vhs.error || rts.error) {
        console.error("Load errors", {
          ops: ops.error,
          jts: jts.error,
          tts: tts.error,
          pus: pus.error,
          des: des.error,
          vhs: vhs.error,
          rts: rts.error,
        });
      }

      setOperators((ops.data as Operator[]) ?? []);
      setJourneyTypes((jts.data as JourneyType[]) ?? []);
      setTransportTypes((tts.data as TransportType[]) ?? []);
      setPickups((pus.data as Pickup[]) ?? []);
      setDestinations((des.data as Destination[]) ?? []);
      setVehicles((vhs.data as Vehicle[]) ?? []);
      setRoutes((rts.data as RouteRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  // Preselect operator from query string (if provided)
  useEffect(() => {
    if (operatorIdFromQS) setOpId(operatorIdFromQS as UUID);
  }, [operatorIdFromQS]);

  /* ---------- Allowed transport labels for the selected operator ---------- */
  const allowedTypeLabels = useMemo(() => {
    if (!opId) return new Set<string>();
    const labels = new Set<string>();
    vehicles
      .filter((v) => v.operator_id === opId && v.active !== false)
      .forEach((v) => {
        const t = transportTypeName(v.type_id);
        if (t) labels.add(t.toLowerCase().trim());
      });
    return labels;
  }, [opId, vehicles, transportTypes]);

  /* ---------- Filtered/visible routes ---------- */
  const visibleRoutes = useMemo(() => {
    let base = routes;

    // Hide routes that don't match the operator's transport types
    if (opId && allowedTypeLabels.size > 0) {
      base = base.filter((r) => allowedTypeLabels.has(labelForRoute(r)));
    }

    // Text search (route name / pickup / destination)
    const s = q.trim().toLowerCase();
    if (!s) return base;

    return base.filter((r) => {
      const pick = pickupById(r.pickup_id)?.name ?? "";
      const dest = destById(r.destination_id)?.name ?? "";
      const title = (r.route_name || r.name || "").toLowerCase();
      return (
        title.includes(s) ||
        pick.toLowerCase().includes(s) ||
        dest.toLowerCase().includes(s)
      );
    });
  }, [routes, opId, allowedTypeLabels, q, pickups, destinations]);

  /* ---------- Operator's vehicles ---------- */
  const operatorVehicles = useMemo(() => {
    if (!opId) return [];
    return vehicles.filter((v) => v.operator_id === opId && v.active !== false);
  }, [opId, vehicles]);

  // Vehicles of same type as the given route
  const vehiclesForRoute = (r: RouteRow) => {
    const routeLabel = labelForRoute(r);
    return operatorVehicles.filter((v) => {
      const t = transportTypeName(v.type_id).toLowerCase().trim();
      return t && t === routeLabel;
    });
  };

  /* ---------- Render ---------- */
  return (
    <div className="space-y-6">
      <section className="flex items-center gap-4">
        <div className="grow">
          <label className="block text-sm text-neutral-600 mb-1">Operator *</label>
          <select
            className="w-full border rounded-lg px-3 py-2"
            value={opId}
            onChange={(e) => setOpId(e.target.value as UUID)}
          >
            <option value="">— Select —</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grow">
          <label className="block text-sm text-neutral-600 mb-1">Search routes</label>
          <input
            className="w-full border rounded-lg px-3 py-2"
            placeholder="Name, pickup, destination…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
        <table className="w-full">
          <thead className="bg-neutral-50">
            <tr>
              <th className="text-left p-3">Route</th>
              <th className="text-left p-3">Pick-up</th>
              <th className="text-left p-3">Destination</th>
              <th className="text-left p-3">Select Boats</th>
              <th className="text-left p-3">Assigned (Preferred)</th>
            </tr>
          </thead>

          {loading ? (
            <tbody>
              <tr>
                <td colSpan={5} className="p-4">Loading…</td>
              </tr>
            </tbody>
          ) : !opId ? (
            <tbody>
              <tr>
                <td colSpan={5} className="p-4">Select an operator to view routes.</td>
              </tr>
            </tbody>
          ) : visibleRoutes.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5} className="p-4">No routes for this operator’s transport types.</td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {visibleRoutes.map((r) => {
                const pick = pickupById(r.pickup_id);
                const dest = destById(r.destination_id);
                const label = labelForRoute(r);
                const matches = vehiclesForRoute(r);

                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-medium">{r.route_name || r.name || "—"}</div>
                      <div className="text-xs text-neutral-600">
                        {(r.is_active ?? true) ? "Active" : "Inactive"} • Type:{" "}
                        {label ? label.charAt(0).toUpperCase() + label.slice(1) : "—"}
                        {r.frequency ? ` • ${r.frequency}` : ""}
                      </div>
                    </td>

                    <td className="p-3">{pick?.name ?? "—"}</td>
                    <td className="p-3">{dest?.name ?? "—"}</td>

                    <td className="p-3">
                      {matches.length === 0 ? (
                        <span className="text-sm text-neutral-500">
                          No boats of type <em>{label ? label.charAt(0).toUpperCase() + label.slice(1) : "—"}</em> for this operator.
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {matches.map((v) => (
                            <span
                              key={v.id}
                              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
                              title={`${v.minseats ?? "?"}–${v.maxseats ?? "?"}`}
                            >
                              {v.name}
                              <span className="opacity-60">
                                ({v.minseats ?? "?"}–{v.maxseats ?? "?"})
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Placeholder: keep your current assignment UI intact if you already have one */}
                    <td className="p-3 text-sm text-neutral-500">None</td>
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </section>
    </div>
  );
}
