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
  active: boolean | null;
  operator_id: UUID | null;
  type_id: string | null; // FK → transport_types.id OR a direct label (e.g., "Speed Boat")
  minseats: number | null;
  maxseats: number | null;
};

type RouteRow = {
  id: UUID;
  route_name: string | null;
  name: string | null;
  pickup_id: UUID | null;
  destination_id: UUID | null;
  frequency: string | null;
  is_active: boolean | null;

  journey_type_id: UUID | null; // references journey_types.id
  transport_type: string | null; // legacy label (display only)
};

/* ---------- Helpers ---------- */
const norm = (s: string) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

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

  // selection state per route
  const [selectedByRoute, setSelectedByRoute] = useState<Record<string, Set<string>>>({});
  const [preferredByRoute, setPreferredByRoute] = useState<Record<string, string | undefined>>({});

  // per-row saving + message
  const [savingByRoute, setSavingByRoute] = useState<Record<string, boolean>>({});
  const [msgByRoute, setMsgByRoute] = useState<Record<string, string | undefined>>({});

  /* ---------- Lookup helpers ---------- */
  const journeyTypeName = (id: UUID | null | undefined) =>
    (id && journeyTypes.find((t) => t.id === id)?.name) || "—";

  const transportTypeNameById = (id: string | null | undefined) =>
    (id && transportTypes.find((t) => t.id === id)?.name) || "";

  const pickupById = (id: UUID | null | undefined) =>
    (id && pickups.find((p) => p.id === id)) || null;

  const destById = (id: UUID | null | undefined) =>
    (id && destinations.find((d) => d.id === id)) || null;

  // Route label we compare against operator transport types (prefer journey type name)
  const routeLabel = (r: RouteRow) => {
    const jt = journeyTypeName(r.journey_type_id);
    return jt !== "—" ? jt : (r.transport_type ?? "");
  };

  /* ---------- Load all lookups & data ---------- */
  useEffect(() => {
    let off = false;

    (async () => {
      try {
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

        // Operators with vehicles-join fallback (handles RLS on operators)
        let opList: Operator[] = (ops.data as Operator[]) ?? [];
        if (opList.length === 0) {
          const join = await sb
            .from("vehicles")
            .select("operator_id, operators!inner(id,name)")
            .not("operator_id", "is", null);

          const uniq: Record<string, Operator> = {};
          (join.data as any[] | null)?.forEach((row) => {
            const op = row.operators;
            if (op?.id && !uniq[op.id]) uniq[op.id] = { id: op.id, name: op.name };
          });
          opList = Object.values(uniq);
        }

        setOperators(opList);
        setJourneyTypes((jts.data as JourneyType[]) ?? []);
        setTransportTypes((tts.data as TransportType[]) ?? []);
        setPickups((pus.data as Pickup[]) ?? []);
        setDestinations((des.data as Destination[]) ?? []);
        setVehicles((vhs.data as Vehicle[]) ?? []);
        setRoutes((rts.data as RouteRow[]) ?? []);
      } finally {
        if (!off) setLoading(false);
      }
    })();

    return () => {
      off = true;
    };
  }, []);

  // Preselect operator from query string (if provided)
  useEffect(() => {
    if (operatorIdFromQS) setOpId(operatorIdFromQS as UUID);
  }, [operatorIdFromQS]);

  /* ---------- Allowed type IDs & labels for the selected operator ---------- */
  const allowedTypeIds = useMemo(() => {
    if (!opId) return new Set<string>();
    const ids = new Set<string>();
    vehicles
      .filter((v) => v.operator_id === opId && v.active !== false && v.type_id)
      .forEach((v) => {
        if (v.type_id && /^[0-9a-f-]{10,}$/i.test(v.type_id)) ids.add(v.type_id);
      });
    return ids;
  }, [opId, vehicles]);

  const allowedLabels = useMemo(() => {
    if (!opId) return new Set<string>();
    const labels = new Set<string>();
    vehicles
      .filter((v) => v.operator_id === opId && v.active !== false && v.type_id)
      .forEach((v) => {
        const resolved = transportTypeNameById(v.type_id);
        if (resolved) labels.add(norm(resolved));
        labels.add(norm(v.type_id!)); // handle varchar label case
      });
    return labels;
  }, [opId, vehicles, transportTypes]);

  /* ---------- Filtered/visible routes ---------- */
  const visibleRoutes = useMemo(() => {
    if (!opId) return routes;

    // Fail-closed: require type match
    return routes.filter((r) => {
      if (r.journey_type_id && allowedTypeIds.has(r.journey_type_id)) return true;
      const lbl = norm(routeLabel(r));
      if (lbl && allowedLabels.has(lbl)) return true;
      return false;
    });
  }, [routes, opId, allowedTypeIds, allowedLabels, journeyTypes]);

  /* ---------- Text search on the filtered list ---------- */
  const searchedRoutes = useMemo(() => {
    const s = norm(q);
    if (!s) return visibleRoutes;
    return visibleRoutes.filter((r) => {
      const pick = pickupById(r.pickup_id)?.name ?? "";
      const dest = destById(r.destination_id)?.name ?? "";
      const titleText = (r.route_name || r.name || "");
      return (
        norm(titleText).includes(s) ||
        norm(pick).includes(s) ||
        norm(dest).includes(s)
      );
    });
  }, [visibleRoutes, q]);

  /* ---------- Operator's vehicles ---------- */
  const operatorVehicles = useMemo(() => {
    if (!opId) return [];
    return vehicles.filter((v) => v.operator_id === opId && v.active !== false);
  }, [opId, vehicles]);

  const vehiclesForRoute = (r: RouteRow) => {
    const rl = norm(routeLabel(r));
    return operatorVehicles.filter((v) => {
      const resolved = transportTypeNameById(v.type_id);
      const resolvedNorm = norm(resolved);
      const rawNorm = norm(v.type_id || "");
      const idMatch = r.journey_type_id && v.type_id && r.journey_type_id === v.type_id;
      const labelMatch = rl === resolvedNorm || rl === rawNorm;
      return Boolean(idMatch || labelMatch);
    });
  };

  /* ---------- Selection & Assign ---------- */
  const toggleVehicleSelection = (routeId: string, vehicleId: string) => {
    setSelectedByRoute((prev) => {
      const next = { ...prev };
      const set = new Set(next[routeId] ?? []);
      if (set.has(vehicleId)) {
        set.delete(vehicleId);
      } else {
        set.add(vehicleId);
      }
      next[routeId] = set;

      // keep preferred valid
      setPreferredByRoute((prevPref) => {
        const currentPreferred = prevPref[routeId];
        if (currentPreferred && !set.has(currentPreferred)) {
          const first = Array.from(set.values())[0];
          return { ...prevPref, [routeId]: first };
        }
        if (!currentPreferred && set.size === 1) {
          const first = Array.from(set.values())[0];
          return { ...prevPref, [routeId]: first };
        }
        return prevPref;
      });

      return next;
    });

    // Optional per-chip callback for backwards compatibility
    if (typeof window !== "undefined") {
      (window as any).onOperatorAssignVehicle?.(routeId, vehicleId);
      try {
        window.dispatchEvent(
          new CustomEvent("operator-assign-vehicle", {
            detail: { routeId, vehicleId },
          })
        );
      } catch {/* no-op */}
    }
  };

  const isSelected = (routeId: string, vehicleId: string) =>
    Boolean(selectedByRoute[routeId]?.has?.(vehicleId));

  const setPreferred = (routeId: string, vehicleId: string) => {
    setPreferredByRoute((prev) => ({ ...prev, [routeId]: vehicleId }));
  };

  const postAssign = async (payload: {
    operatorId: string;
    routeId: string;
    vehicleIds: string[];
    preferredVehicleId: string;
  }) => {
    // primary endpoint
    let res = await fetch("/api/operator/routes/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    // fallback if the primary path doesn't exist
    if (res.status === 404) {
      res = await fetch("/api/admin/routes/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    }
    return res;
  };

  const onAssign = async (routeId: string) => {
    const selectedIds = Array.from(selectedByRoute[routeId] ?? []);
    if (selectedIds.length === 0 || !opId) return;

    const preferredId =
      preferredByRoute[routeId] && selectedIds.includes(preferredByRoute[routeId]!)
        ? preferredByRoute[routeId]!
        : selectedIds[0];

    // Show saving state
    setSavingByRoute((p) => ({ ...p, [routeId]: true }));
    setMsgByRoute((p) => ({ ...p, [routeId]: undefined }));

    try {
      // legacy/event hooks (don’t remove)
      if (typeof window !== "undefined") {
        (window as any).onOperatorAssignVehicles?.(routeId, selectedIds, preferredId);
        try {
          window.dispatchEvent(
            new CustomEvent("operator-assign-vehicles", {
              detail: { routeId, selectedIds, preferredId },
            })
          );
        } catch {/* no-op */}
      }

      // real API call
      const res = await postAssign({
        operatorId: opId as string,
        routeId,
        vehicleIds: selectedIds,
        preferredVehicleId: preferredId,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Assign failed (${res.status})`);
      }

      setMsgByRoute((p) => ({ ...p, [routeId]: "Assigned ✅" }));
    } catch (err: any) {
      setMsgByRoute((p) => ({ ...p, [routeId]: err?.message ?? "Assign failed" }));
    } finally {
      setSavingByRoute((p) => ({ ...p, [routeId]: false }));
    }
  };

  /* ---------- Dynamic column header ---------- */
  const selectHeader = useMemo(() => {
    if (!opId || searchedRoutes.length === 0) return "Select Vehicles";
    const labels = new Set<string>();
    searchedRoutes.forEach((r) => labels.add(title(norm(routeLabel(r)))));
    if (labels.size === 1) {
      const only = Array.from(labels)[0];
      return `Select ${only}${only.endsWith("s") ? "" : "s"}`;
    }
    return "Select Vehicles";
  }, [opId, searchedRoutes]);

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
              <th className="text-left p-3">{selectHeader}</th>
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
          ) : searchedRoutes.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5} className="p-4">No routes for this operator’s transport types.</td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {searchedRoutes.map((r) => {
                const pick = pickupById(r.pickup_id);
                const dest = destById(r.destination_id);
                const rl = routeLabel(r);
                const chips = vehiclesForRoute(r);

                const sel = selectedByRoute[r.id] ?? new Set<string>();
                const selectedCount = sel.size;
                const preferredId =
                  (preferredByRoute[r.id] && sel.has(preferredByRoute[r.id]!))
                    ? preferredByRoute[r.id]
                    : undefined;

                const assignBtnLabel =
                  selectedCount === 0
                    ? "Assign 0 vehicle(s)"
                    : `Assign ${selectedCount} vehicle${selectedCount > 1 ? "s" : ""}`;

                const saving = !!savingByRoute[r.id];
                const rowMsg = msgByRoute[r.id];

                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-medium">{r.route_name || r.name || "—"}</div>
                      <div className="text-xs text-neutral-600">
                        {(r.is_active ?? true) ? "Active" : "Inactive"} • Type: {title(norm(rl))}
                        {r.frequency ? ` • ${r.frequency}` : ""}
                      </div>
                    </td>

                    <td className="p-3">{pick?.name ?? "—"}</td>
                    <td className="p-3">{dest?.name ?? "—"}</td>

                    <td className="p-3">
                      {chips.length === 0 ? (
                        <span className="text-sm text-neutral-500">
                          No vehicles of type <em>{title(norm(rl))}</em> for this operator.
                        </span>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            {chips.map((v) => {
                              const pressed = (selectedByRoute[r.id]?.has?.(v.id)) ?? false;
                              return (
                                <button
                                  key={v.id}
                                  type="button"
                                  data-route-id={r.id}
                                  data-vehicle-id={v.id}
                                  aria-pressed={pressed}
                                  onClick={() => toggleVehicleSelection(r.id, v.id)}
                                  className={
                                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition " +
                                    (pressed ? "bg-black text-white" : "")
                                  }
                                  title={`${v.minseats ?? "?"}–${v.maxseats ?? "?"}`}
                                >
                                  {v.name}
                                  <span className="opacity-60">
                                    ({v.minseats ?? "?"}–{v.maxseats ?? "?"})
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          {/* Preferred picker appears only when 2+ are selected */}
                          {selectedCount > 1 && (
                            <div className="flex items-center flex-wrap gap-3">
                              <span className="text-xs text-neutral-600">Preferred:</span>
                              {Array.from(sel.values()).map((vid) => {
                                const veh = chips.find((c) => c.id === vid);
                                return (
                                  <label key={vid} className="inline-flex items-center gap-1 text-xs">
                                    <input
                                      type="radio"
                                      name={`pref-${r.id}`}
                                      checked={preferredId ? preferredId === vid : false}
                                      onChange={() => setPreferred(r.id, vid)}
                                    />
                                    <span>{veh?.name ?? "—"}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={selectedCount === 0 || saving}
                              onClick={() => onAssign(r.id)}
                              className="mt-1 inline-flex rounded-full px-3 py-1 border text-sm disabled:opacity-50"
                            >
                              {saving ? "Assigning…" : assignBtnLabel}
                            </button>
                            {rowMsg && (
                              <span className="text-xs text-neutral-600">{rowMsg}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Keep your existing “Assigned (Preferred)” cell */}
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
