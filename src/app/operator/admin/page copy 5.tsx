// src/app/operator/admin/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Supabase (browser) */
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------------------- Types ---------------------- */
type PsUser = {
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  email?: string | null;
};

type WithVehicleRow = {
  id: string; // journey id
  route_id: string;
  departure_ts: string; // ISO
  pickup_name: string | null;
  destination_name: string | null;
  vehicle_id: string;
  vehicle_name: string;
  vehicle_operator_id: string | null;
  seats_capacity: number | null;
  booked_seats: number;
};

type NeedsAssignRow = {
  id: string; // journey id
  route_id: string;
  departure_ts: string; // ISO
  pickup_name: string | null;
  destination_name: string | null;
  booked_seats: number;
};

type Vehicle = {
  id: string;
  name: string;
  operator_id: string | null;
  maxseats: number | null;
};

type BookingRow = {
  id: string;
  customer_name: string | null;
  seats: number;
  status: string | null;
};

/** Counts + manifest rows from views */
type PaxCountRow = { journey_id: string; pax: number };
type ManifestPlusRow = { order_id: string; first_name: string | null; last_name: string | null; is_lead: boolean };
type ManifestParty = { order_id: string; people: ManifestPlusRow[] };

/* ---------------------- Config / helpers ---------------------- */
const REMOVAL_RULES = {
  requireSameOperator: true,
  blockPastDeparture: true, // don’t allow changes on past departures
};

function readCachedUser(): PsUser | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}

function fmtDate(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function isFuture(ts: string) {
  return new Date(ts).getTime() > Date.now();
}

/* ---------------------- Component ---------------------- */
export default function JourneyBoardsPage(): JSX.Element {
  const [user, setUser] = React.useState<PsUser | null>(null);
  const [withVehicle, setWithVehicle] = React.useState<WithVehicleRow[]>([]);
  const [needsAssign, setNeedsAssign] = React.useState<NeedsAssignRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Vehicles for the operator (for assignment)
  const [vehicles, setVehicles] = React.useState<Vehicle[] | null>(null);
  const [loadingVehicles, setLoadingVehicles] = React.useState(false);

  // Assign / change vehicle dialog
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignJourneyId, setAssignJourneyId] = React.useState<string | null>(null);
  const [assignSelectedVehicleId, setAssignSelectedVehicleId] = React.useState<string | null>(null);
  const [assignBusy, setAssignBusy] = React.useState(false);

  // Manifest side panel
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [manifestJourneyId, setManifestJourneyId] = React.useState<string | null>(null);
  const [manifestBookings, setManifestBookings] = React.useState<BookingRow[] | null>(null); // fallback
  const [manifestParties, setManifestParties] = React.useState<ManifestParty[] | null>(null); // preferred
  const [manifestLoading, setManifestLoading] = React.useState(false);
  const [manifestInfo, setManifestInfo] = React.useState<{ title: string; subtitle: string } | null>(null);

  React.useEffect(() => {
    setUser(readCachedUser());
  }, []);

  React.useEffect(() => {
    let aborted = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const nowIso = new Date().toISOString();

        // 1) WITH vehicle — disambiguate the route embed (avoid PostgREST ambiguity)
        const { data: jWith, error: eWith } = await supabase
          .from("journeys")
          .select(
            `
            id,
            route_id,
            departure_ts,
            vehicle_id,
            routes:routes!journeys_route_fk(
              id,
              pickup:pickup_id(name),
              destination:destination_id(name)
            ),
            vehicles:vehicle_id(
              id, name, operator_id, maxseats
            )
          `.replace(/\s+/g, " ")
          )
          .eq("is_active", true)
          .not("vehicle_id", "is", null)
          .gte("departure_ts", nowIso)
          .order("departure_ts", { ascending: true });

        if (eWith) throw eWith;

        // 2) WITHOUT vehicle — disambiguate the route embed
        const { data: jNo, error: eNo } = await supabase
          .from("journeys")
          .select(
            `
            id,
            route_id,
            departure_ts,
            routes:routes!journeys_route_fk(
              id,
              pickup:pickup_id(name),
              destination:destination_id(name)
            )
          `.replace(/\s+/g, " ")
          )
          .eq("is_active", true)
          .is("vehicle_id", null)
          .gte("departure_ts", nowIso)
          .order("departure_ts", { ascending: true });

        if (eNo) throw eNo;

        // 3) Booked counts per journey — prefer the passengers view, fallback to bookings sum
        const allJourneyIds: string[] = [
          ...(jWith?.map((j: any) => j.id) ?? []),
          ...(jNo?.map((j: any) => j.id) ?? []),
        ];

        const byJourneyCount = new Map<string, number>();

        let countsFromView = false;
        if (allJourneyIds.length > 0) {
          try {
            const { data: paxCounts, error: paxErr } = await supabase
              .from("journey_order_passenger_counts") // people-per-journey view
              .select("journey_id,pax")
              .in("journey_id", allJourneyIds);

            if (!paxErr && paxCounts) {
              for (const r of paxCounts as PaxCountRow[]) {
                byJourneyCount.set(r.journey_id, Number(r.pax) || 0);
              }
              countsFromView = true;
            }
          } catch {
            // view missing or RLS blocked; silently fall back
          }
        }

        // Fallback to bookings sum if view not available
        if (!countsFromView && allJourneyIds.length > 0) {
          const { data: bookings, error: eB } = await supabase
            .from("bookings")
            .select("journey_id, seats")
            .in("journey_id", allJourneyIds);

          if (eB) throw eB;

          for (const b of bookings ?? []) {
            const jid = (b as any).journey_id as string;
            const s = Number((b as any).seats) || 0;
            byJourneyCount.set(jid, (byJourneyCount.get(jid) ?? 0) + s);
          }
        }

        // 4) Shape with-vehicle rows
        const wv: WithVehicleRow[] = (jWith ?? []).map((j: any) => {
          const pickup_name = j.routes?.pickup?.name ?? null;
          const destination_name = j.routes?.destination?.name ?? null;
          const vehicle_name = j.vehicles?.name ?? "(vehicle)";
          const vehicle_operator_id = j.vehicles?.operator_id ?? null;
          const seats_capacity = j.vehicles?.maxseats ?? null;
          const booked_seats = byJourneyCount.get(j.id) ?? 0;

          return {
            id: j.id,
            route_id: j.route_id,
            departure_ts: j.departure_ts,
            pickup_name,
            destination_name,
            vehicle_id: j.vehicle_id,
            vehicle_name,
            vehicle_operator_id,
            seats_capacity,
            booked_seats,
          };
        });

        // 5) Shape needs-assignment rows (only if booked_seats > 0)
        const na: NeedsAssignRow[] = (jNo ?? [])
          .map((j: any) => {
            const pickup_name = j.routes?.pickup?.name ?? null;
            const destination_name = j.routes?.destination?.name ?? null;
            const booked_seats = byJourneyCount.get(j.id) ?? 0;
            return {
              id: j.id,
              route_id: j.route_id,
              departure_ts: j.departure_ts,
              pickup_name,
              destination_name,
              booked_seats,
            };
          })
          .filter((row) => row.booked_seats > 0);

        if (!aborted) {
          setWithVehicle(wv);
          setNeedsAssign(na);
        }
      } catch (e: any) {
        console.error(e);
        if (!aborted) setErr(e.message ?? String(e));
      } finally {
        if (!aborted) setLoading(false);
      }
    }
    load();
    return () => {
      aborted = true;
    };
  }, [refreshKey]);

  /** -------- Vehicles loader (for current operator) -------- */
  async function ensureVehiclesLoaded() {
    if (vehicles !== null) return;
    const opId = readCachedUser()?.operator_id;
    if (!opId) {
      setVehicles([]);
      return;
    }
    setLoadingVehicles(true);
    try {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, name, operator_id, maxseats")
        .eq("operator_id", opId)
        .order("name", { ascending: true });
      if (error) throw error;
      setVehicles(data ?? []);
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setVehicles([]);
    } finally {
      setLoadingVehicles(false);
    }
  }

  /** -------- Assign / Change vehicle -------- */
  function openAssign(journeyId: string) {
    setAssignJourneyId(journeyId);
    setAssignSelectedVehicleId(null);
    setAssignOpen(true);
    ensureVehiclesLoaded();
  }
  function closeAssign() {
    setAssignOpen(false);
    setAssignJourneyId(null);
    setAssignSelectedVehicleId(null);
  }
  async function confirmAssign() {
    if (!assignJourneyId || !assignSelectedVehicleId) return;
    setAssignBusy(true);
    setErr(null);
    try {
      const v = (vehicles ?? []).find((x) => x.id === assignSelectedVehicleId);
      if (!v) throw new Error("Vehicle not found");

      const { error } = await supabase
        .from("journeys")
        .update({ vehicle_id: v.id, operator_id: v.operator_id })
        .eq("id", assignJourneyId)
        .eq("is_active", true);

      if (error) throw error;

      closeAssign();
      setRefreshKey((x) => x + 1);
    } catch (e: any) {
      console.error(e);
      setErr(e.message ?? String(e));
    } finally {
      setAssignBusy(false);
    }
  }

  /** -------- Remove vehicle with guardrails -------- */
  function canOperate(vehicleOperatorId?: string | null) {
    const u = readCachedUser();
    if (!u?.operator_admin) return false;
    if (!u?.operator_id) return false;
    if (REMOVAL_RULES.requireSameOperator && vehicleOperatorId) {
      return vehicleOperatorId === u.operator_id;
    }
    return true;
  }

  function canRemove(row: WithVehicleRow) {
    if (!canOperate(row.vehicle_operator_id)) return false;
    if (REMOVAL_RULES.blockPastDeparture && !isFuture(row.departure_ts)) return false;
    // Allowed even with bookings: moves journey right for reassignment.
    return true;
  }

  async function onRemoveVehicle(row: WithVehicleRow) {
    if (!canRemove(row)) return;

    if (row.booked_seats > 0) {
      const ok = window.confirm(
        `This journey has ${row.booked_seats} booked passenger(s).\n\n` +
          `Removing the vehicle will move this journey to "Journeys needing assignment". ` +
          `Bookings remain attached to the journey for reassignment.\n\nContinue?`
      );
      if (!ok) return;
    }

    setErr(null);
    try {
      const { error } = await supabase
        .from("journeys")
        .update({ vehicle_id: null })
        .eq("id", row.id)
        .eq("is_active", true);

      if (error) throw error;
      setRefreshKey((x) => x + 1);
    } catch (e: any) {
      console.error(e);
      setErr(e.message ?? String(e));
    }
  }

  /** -------- Manifest panel -------- */
  async function openManifest(journeyId: string, title: string, subtitle: string) {
    setManifestOpen(true);
    setManifestJourneyId(journeyId);
    setManifestInfo({ title, subtitle });
    setManifestBookings(null);
    setManifestParties(null);
    setManifestLoading(true);
    setErr(null);
    try {
      // Preferred: passengers grouped by booking from journey_order_manifest_plus
      let filled = false;
      try {
        const { data: paxData, error: paxErr } = await supabase
          .from("journey_order_manifest_plus")
          .select("order_id,first_name,last_name,is_lead")
          .eq("journey_id", journeyId)
          .order("order_id", { ascending: true })
          .order("is_lead", { ascending: false })
          .order("last_name", { ascending: true });

        if (!paxErr && paxData) {
          // group by order_id
          const groups = new Map<string, ManifestPlusRow[]>();
          for (const r of paxData as ManifestPlusRow[]) {
            const arr = groups.get(r.order_id) ?? [];
            arr.push(r);
            groups.set(r.order_id, arr);
          }
          const parties: ManifestParty[] = Array.from(groups.entries()).map(([order_id, people]) => ({
            order_id,
            people,
          }));
          setManifestParties(parties);
          filled = parties.length > 0;
        }
      } catch {
        // view missing / RLS — fall back
      }

      // Fallback: show bookings list (legacy)
      if (!filled) {
        const { data, error } = await supabase
          .from("bookings")
          .select("id, customer_name, seats, status")
          .eq("journey_id", journeyId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        setManifestBookings((data ?? []) as BookingRow[]);
      }
    } catch (e: any) {
      console.error(e);
      setErr(e.message ?? String(e));
    } finally {
      setManifestLoading(false);
    }
  }
  function closeManifest() {
    setManifestOpen(false);
    setManifestJourneyId(null);
    setManifestBookings(null);
    setManifestParties(null);
    setManifestInfo(null);
  }

  return (
    <div className="space-y-4 relative">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold">Operator dashboard — journey boards</h2>
        <button
          onClick={() => setRefreshKey((x) => x + 1)}
          className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border p-6 text-sm text-gray-600">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Left card — with vehicle */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Upcoming journeys (with vehicle)</h3>
              <span className="text-xs text-gray-500">{withVehicle.length} item(s)</span>
            </div>
            {withVehicle.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-gray-500">
                No upcoming journeys with vehicles assigned.
              </div>
            ) : (
              <ul className="divide-y">
                {withVehicle.map((row) => {
                  const allowRemove = canRemove(row);
                  const over = row.seats_capacity != null && row.booked_seats > row.seats_capacity;
                  return (
                    <li key={row.id} className="py-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {row.pickup_name ?? "Pickup"} → {row.destination_name ?? "Destination"}
                            </div>
                            <div className="text-xs text-gray-500">
                              {fmtDate(row.departure_ts)} · Vehicle: {row.vehicle_name}
                            </div>
                          </div>
                          <div className="ml-3 shrink-0 text-right">
                            <div className={classNames("text-sm font-semibold", over && "text-red-600")}>
                              {row.booked_seats}/{row.seats_capacity ?? "?"}
                            </div>
                            <div className="text-[11px] text-gray-500">booked / capacity</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              openManifest(
                                row.id,
                                `${row.pickup_name ?? "Pickup"} → ${row.destination_name ?? "Destination"}`,
                                fmtDate(row.departure_ts)
                              )
                            }
                            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                            title="View manifest"
                          >
                            Manifest
                          </button>

                          <button
                            onClick={() => openAssign(row.id)}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                            title="Change vehicle"
                            disabled={!canOperate(row.vehicle_operator_id) || !isFuture(row.departure_ts)}
                          >
                            Change vehicle
                          </button>

                          <button
                            onClick={() => onRemoveVehicle(row)}
                            className={classNames(
                              "rounded-md border px-2 py-1 text-xs",
                              allowRemove ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
                            )}
                            title={
                              allowRemove
                                ? "Remove vehicle assignment"
                                : "You don’t have permission or the departure is in the past"
                            }
                            disabled={!allowRemove}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right card — needs assignment */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Journeys needing assignment</h3>
              <span className="text-xs text-gray-500">{needsAssign.length} item(s)</span>
            </div>
            {needsAssign.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-gray-500">
                All set — no gaps.
              </div>
            ) : (
              <ul className="divide-y">
                {needsAssign.map((row) => (
                  <li key={row.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {row.pickup_name ?? "Pickup"} → {row.destination_name ?? "Destination"}
                        </div>
                        <div className="text-xs text-gray-500">{fmtDate(row.departure_ts)}</div>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <div className="text-sm font-semibold">{row.booked_seats}</div>
                        <div className="text-[11px] text-gray-500">booked passengers</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => openAssign(row.id)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                        disabled={!canOperate()}
                      >
                        Assign vehicle
                      </button>
                      <button
                        onClick={() =>
                          openManifest(
                            row.id,
                            `${row.pickup_name ?? "Pickup"} → ${row.destination_name ?? "Destination"}`,
                            fmtDate(row.departure_ts)
                          )
                        }
                        className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Manifest
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Assign / Change vehicle dialog */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow p-4 space-y-3">
            <div className="text-base font-semibold">Select a vehicle</div>
            {loadingVehicles ? (
              <div className="text-sm text-gray-600">Loading vehicles…</div>
            ) : (vehicles ?? []).length === 0 ? (
              <div className="text-sm text-gray-600">No vehicles found for your operator.</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto pr-1">
                {(vehicles ?? []).map((v) => (
                  <label key={v.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className="text-xs text-gray-500">Capacity: {v.maxseats ?? "?"}</div>
                    </div>
                    <input
                      type="radio"
                      name="veh"
                      value={v.id}
                      checked={assignSelectedVehicleId === v.id}
                      onChange={() => setAssignSelectedVehicleId(v.id)}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={closeAssign}
                className="rounded-md border px-3 py-1 text-sm hover:bg-gray-50"
                disabled={assignBusy}
              >
                Cancel
              </button>
              <button
                onClick={confirmAssign}
                className="rounded-md bg-black text-white px-3 py-1 text-sm disabled:opacity-50"
                disabled={!assignSelectedVehicleId || assignBusy}
              >
                {assignBusy ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manifest drawer */}
      {manifestOpen && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/20" onClick={closeManifest} aria-hidden />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl p-4 overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Passenger manifest</div>
                {manifestInfo && (
                  <div className="text-xs text-gray-500">
                    {manifestInfo.title} · {manifestInfo.subtitle}
                  </div>
                )}
              </div>
              <button onClick={closeManifest} className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50">
                Close
              </button>
            </div>

            {manifestLoading ? (
              <div className="mt-4 text-sm text-gray-600">Loading…</div>
            ) : manifestParties && manifestParties.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {manifestParties.map((party) => (
                  <li key={party.order_id} className="rounded-md border p-3">
                    <div className="text-xs text-gray-500 mb-2">Booking</div>
                    <ul className="space-y-1">
                      {party.people.map((p, idx) => {
                        const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "—";
                        return (
                          <li key={`${party.order_id}-${idx}`} className="flex items-center gap-2">
                            <span className="truncate">{name}</span>
                            {p.is_lead ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                                Lead passenger
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (manifestBookings ?? []).length === 0 ? (
              <div className="mt-4 text-sm text-gray-600">No passengers yet.</div>
            ) : (
              <ul className="mt-4 space-y-2">
                {(manifestBookings ?? []).map((b) => (
                  <li key={b.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{b.customer_name || "—"}</div>
                        <div className="text-xs text-gray-500">Status: {b.status || "—"}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">{b.seats}</div>
                        <div className="text-[11px] text-gray-500">seats</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
