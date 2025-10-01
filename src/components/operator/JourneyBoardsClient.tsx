// src/components/operator/JourneyBoardsClient.jsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Supabase (browser) — JS-safe */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}
const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON);

/* ---------------------- Helpers ---------------------- */
function readCachedUser() {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function fmtDate(ts) {
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

function sumSeats(bookings) {
  if (!bookings) return 0;
  return bookings.reduce((n, b) => n + (Number(b.seats) || 0), 0);
}

/* ---------------------- Component ---------------------- */
export default function JourneyBoardsClient() {
  const [withVehicle, setWithVehicle] = React.useState([]);
  const [needsAssign, setNeedsAssign] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // manifest drawer state
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [manifestJourney, setManifestJourney] = React.useState(null);
  const [manifestRows, setManifestRows] = React.useState(null);
  const [manifestBookings, setManifestBookings] = React.useState(null);
  const [manifestErr, setManifestErr] = React.useState(null);
  const [manifestLoading, setManifestLoading] = React.useState(false);
  const [noPassengerReason, setNoPassengerReason] = React.useState("none"); // "none" | "rls" | "no_orders"

  React.useEffect(() => {
    let aborted = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const nowIso = new Date().toISOString();

        // 1) WITH vehicle — explicit route embed to avoid ambiguity
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

        // 2) WITHOUT vehicle — same explicit embed
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

        // 3) Passenger counts per journey — triple fallback
        const allJourneyIds = [
          ...(jWith?.map((j) => j.id) ?? []),
          ...(jNo?.map((j) => j.id) ?? []),
        ];

        const byJourneyPassengerCount = new Map();

        if (allJourneyIds.length > 0) {
          let filled = false;

          // 3a) Preferred: counts view (journey_id, pax)
          try {
            const { data: paxCounts, error } = await supabase
              .from("journey_order_passenger_counts")
              .select("journey_id,pax")
              .in("journey_id", allJourneyIds);

            if (!error && paxCounts && paxCounts.length > 0) {
              paxCounts.forEach((r) =>
                byJourneyPassengerCount.set(r.journey_id, Number(r.pax) || 0)
              );
              filled = true;
            }
          } catch {}

          // 3b) Fallback: count rows from manifest view
          if (!filled) {
            try {
              const { data: paxRows, error } = await supabase
                .from("journey_order_manifest_plus")
                .select("journey_id")
                .in("journey_id", allJourneyIds);

              if (!error && paxRows && paxRows.length > 0) {
                paxRows.forEach((r) => {
                  const jid = r.journey_id;
                  byJourneyPassengerCount.set(
                    jid,
                    (byJourneyPassengerCount.get(jid) ?? 0) + 1
                  );
                });
                filled = true;
              }
            } catch {}
          }

          // 3c) Last resort: sum bookings.seats
          if (!filled) {
            const { data: bookings, error } = await supabase
              .from("bookings")
              .select("journey_id, seats")
              .in("journey_id", allJourneyIds);

            if (!error && bookings) {
              bookings.forEach((b) => {
                const jid = b.journey_id;
                const s = Number(b.seats) || 0;
                byJourneyPassengerCount.set(jid, (byJourneyPassengerCount.get(jid) ?? 0) + s);
              });
            }
          }
        }

        // 4) Shape with-vehicle rows (booked_seats from passenger count)
        const baseWv = (jWith ?? []).map((j) => {
          const pickup_name = j.routes?.pickup?.name ?? null;
          const destination_name = j.routes?.destination?.name ?? null;
          const vehicle_name = j.vehicles?.name ?? "(vehicle)";
          const vehicle_operator_id = j.vehicles?.operator_id ?? null;
          const seats_capacity = j.vehicles?.maxseats ?? null;
          const booked_seats = byJourneyPassengerCount.get(j.id) ?? 0;

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

        // 4a) LEFT PANEL FILTERING:
        const u = readCachedUser();
        let wv = baseWv.filter((row) => row.booked_seats > 0);
        if (u?.operator_admin && u?.operator_id) {
          wv = wv.filter((row) => row.vehicle_operator_id === u.operator_id);
        }

        // 5) Shape needs-assignment rows (only if booked_seats > 0)
        const na = (jNo ?? [])
          .map((j) => {
            const pickup_name = j.routes?.pickup?.name ?? null;
            const destination_name = j.routes?.destination?.name ?? null;
            const booked_seats = byJourneyPassengerCount.get(j.id) ?? 0;
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
      } catch (e) {
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

  // manifest fetch when opened / journey changes — VIEW → SINGLE-JOIN → bookings(+reason)
  React.useEffect(() => {
    let cancelled = false;
    async function loadManifest() {
      if (!manifestOpen || !manifestJourney?.id) return;
      setManifestLoading(true);
      setManifestErr(null);
      setManifestRows(null);
      setManifestBookings(null);
      setNoPassengerReason("none");

      let rows = null;

      // A) Preferred: pre-joined view
      try {
        const { data, error } = await supabase
          .from("journey_order_manifest_plus")
          .select("journey_id, order_id, first_name, last_name, is_lead")
          .eq("journey_id", manifestJourney.id)
          .order("order_id", { ascending: true })
          .order("is_lead", { ascending: false })
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true });

        if (!error && data && data.length > 0) rows = data;
      } catch (e) {}

      // B) Two-step via bookings → passengers
      if (!rows) {
        try {
          const { data: bks, error: bErr } = await supabase
            .from("bookings")
            .select("order_id, customer_name, seats, status")
            .eq("journey_id", manifestJourney.id);

          if (!bErr) setManifestBookings(bks ?? []);

          const orderIds = Array.from(new Set((bks ?? []).map((b) => b.order_id).filter(Boolean)));

          if (orderIds.length > 0) {
            const { data: pax, error: pErr } = await supabase
              .from("order_passengers")
              .select("order_id, first_name, last_name, is_lead")
              .in("order_id", orderIds)
              .order("order_id", { ascending: true })
              .order("is_lead", { ascending: false })
              .order("last_name", { ascending: true })
              .order("first_name", { ascending: true });

            if (!pErr && pax && pax.length > 0) {
              rows = (pax ?? []).map((r) => ({
                journey_id: manifestJourney.id,
                order_id: r.order_id,
                first_name: r.first_name,
                last_name: r.last_name,
                is_lead: !!r.is_lead,
              }));
            } else if (!pErr && orderIds.length > 0 && (!pax || pax.length === 0)) {
              setNoPassengerReason("rls");
            }
          } else {
            setNoPassengerReason("no_orders");
          }
        } catch (e) {}
      }

      if (rows) {
        if (!cancelled) {
          setManifestRows(rows);
          setManifestLoading(false);
        }
        return;
      }

      if (!cancelled) setManifestLoading(false);
    }
    loadManifest();
    return () => {
      cancelled = true;
    };
  }, [manifestOpen, manifestJourney?.id]);

  async function onRemoveVehicle(journeyId) {
    setErr(null);
    try {
      const { error } = await supabase
        .from("journeys")
        .update({ vehicle_id: null })
        .eq("id", journeyId)
        .eq("is_active", true);

      if (error) throw error;
      setRefreshKey((x) => x + 1);
    } catch (e) {
      console.error(e);
      setErr(e.message ?? String(e));
    }
  }

  const canRemoveFor = React.useCallback((row) => {
    const raw = localStorage.getItem("ps_user");
    let u = null;
    try {
      u = raw ? JSON.parse(raw) : null;
    } catch {}
    if (!u?.operator_admin) return false;
    if (!u?.operator_id) return false;
    return row.vehicle_operator_id === u.operator_id;
  }, []);

  const manifestCount =
    (manifestRows && manifestRows.length) ||
    sumSeats(manifestBookings) ||
    0;

  return (
    <div className="space-y-4">
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
          {/* Left card — with vehicle (filtered) */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">Upcoming journeys (with vehicle)</h3>
              <span className="text-xs text-gray-500">{withVehicle.length} item(s)</span>
            </div>
            {withVehicle.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-gray-500">
                No upcoming journeys with passengers on your vehicles.
              </div>
            ) : (
              <ul className="divide-y">
                {withVehicle.map((row) => {
                  const allowRemove = canRemoveFor(row);
                  const title = `${row.pickup_name ?? "Pickup"} → ${row.destination_name ?? "Destination"}`;
                  return (
                    <li key={row.id} className="py-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{title}</div>
                            <div className="text-xs text-gray-500">
                              {fmtDate(row.departure_ts)} · Vehicle: {row.vehicle_name}
                            </div>
                          </div>
                          <div className="ml-3 shrink-0 text-right">
                            <div className="text-sm font-semibold">
                              {row.booked_seats}/{row.seats_capacity ?? "?"}
                            </div>
                            <div className="text-[11px] text-gray-500">booked / capacity</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setManifestJourney({
                                id: row.id,
                                title,
                                datetime: fmtDate(row.departure_ts),
                                vehicle_name: row.vehicle_name,
                                capacity: row.seats_capacity,
                              });
                              setManifestOpen(true);
                            }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                          >
                            Manifest
                          </button>

                          {allowRemove ? (
                            <button
                              onClick={() => onRemoveVehicle(row.id)}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                              title="Remove vehicle assignment for this journey"
                            >
                              Remove
                            </button>
                          ) : null}
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
                {needsAssign.map((row) => {
                  const title = `${row.pickup_name ?? "Pickup"} → ${row.destination_name ?? "Destination"}`;
                  return (
                    <li key={row.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{title}</div>
                          <div className="text-xs text-gray-500">{fmtDate(row.departure_ts)}</div>
                        </div>
                        <div className="ml-3 shrink-0 text-right">
                          <div className="text-sm font-semibold">{row.booked_seats}</div>
                          <div className="text-[11px] text-gray-500">booked passengers</div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Manifest Drawer */}
      <aside
        inert={!manifestOpen}
        className={[
          "fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-white shadow-2xl border-l",
          "transition-transform duration-200",
          manifestOpen ? "translate-x-0" : "translate-x-full",
          "z-50"
        ].join(" ")}
        role="dialog"
        aria-label="Passenger manifest"
      >
        {/* Header */}
        <div className="p-4 border-b flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-gray-500 truncate">
              {manifestJourney?.title || "Journey"}
            </div>
            <div className="text-xs text-gray-500">
              {manifestJourney?.datetime}
              {manifestJourney?.vehicle_name ? ` • Vehicle: ${manifestJourney.vehicle_name}` : ""}
            </div>
            <div className="mt-2 text-sm font-medium">
              {manifestJourney?.capacity != null
                ? `${manifestCount}/${manifestJourney.capacity} passengers`
                : `${manifestCount} passengers`}
            </div>
          </div>

          <button
            className="px-2 py-1 text-sm border rounded-md hover:bg-gray-50"
            onClick={() => setManifestOpen(false)}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="p-3 overflow-y-auto h-[calc(100%-56px)]">
          {/* Hints / reasons when there are no per-passenger rows */}
          {!manifestLoading && !manifestErr && (!manifestRows || manifestRows.length === 0) && (manifestBookings ?? []).length > 0 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] leading-snug text-amber-900">
              {noPassengerReason === "no_orders" ? (
                <span>
                  No per-passenger records are linked to these bookings. These bookings don’t have an
                  <code className="mx-1 rounded bg-white/70 px-1">order_id</code>, so the system can’t
                  find passengers in <code className="mx-1 rounded bg-white/70 px-1">order_passengers</code>. The list below shows the booking leads instead.
                </span>
              ) : noPassengerReason === "rls" ? (
                <span>
                  Passenger rows exist, but RLS is blocking the read from{" "}
                  <code className="mx-1 rounded bg-white/70 px-1">order_passengers</code>. Mirror the
                  bookings policy for ops on <code className="mx-1 rounded bg-white/70 px-1">order_passengers</code>
                  (or use the single-query join policy).
                </span>
              ) : (
                <span>
                  No per-passenger rows were returned. Showing bookings as a fallback.
                </span>
              )}
            </div>
          )}

          {manifestLoading && <div className="text-sm text-gray-500">Loading manifest…</div>}

          {manifestErr && (
            <div className="text-sm text-red-600">
              Error loading manifest: {manifestErr}
            </div>
          )}

          {/* Preferred: per-passenger names grouped by order */}
          {!manifestLoading && !manifestErr && manifestRows && manifestRows.length > 0 && (
            <ManifestGroupedList rows={manifestRows} />
          )}

          {/* Fallback: bookings list (lead indicated) */}
          {!manifestLoading && !manifestErr && (!manifestRows || manifestRows.length === 0) && (
            <div>
              {(manifestBookings ?? []).length === 0 ? (
                <div className="text-sm text-gray-500">No passengers yet.</div>
              ) : (
                <ul className="space-y-2">
                  {(manifestBookings ?? []).map((b, idx) => (
                    <li key={`${b.id ?? "noid"}-${idx}`} className="rounded-md border p-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            <span className="mr-2 rounded-full bg-black px-2 py-0.5 text-[11px] text-white">Lead</span>
                            {b.customer_name || "—"}
                          </div>
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
          )}
        </div>
      </aside>
    </div>
  );
}

/* ---------------------- Subcomponent: grouped passenger list ---------------------- */
function ManifestGroupedList({ rows }) {
  // group by order_id
  const groups = React.useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const a = m.get(r.order_id) ?? [];
      a.push(r);
      m.set(r.order_id, a);
    });
    return Array.from(m.entries());
  }, [rows]);

  return (
    <ul className="space-y-3">
      {groups.map(([orderId, people]) => {
        const lead = people.find((p) => p.is_lead);
        const others = people.filter((p) => !p.is_lead);

        return (
          <li key={orderId} className="border rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                Booking <span className="font-mono text-xs">{(orderId || "").slice(0, 8)}</span>
              </div>
            </div>

            {lead && (
              <div className="mt-2">
                <div className="text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-black text-white">
                      Lead
                    </span>
                    {lead.first_name} {lead.last_name}
                  </span>
                </div>
              </div>
            )}

            {others.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-gray-500">Other passengers</div>
                <ul className="mt-1 space-y-1">
                  {others.map((p, i) => (
                    <li key={`${orderId}_${p.first_name}_${p.last_name}_${i}`} className="text-sm">
                      {p.first_name} {p.last_name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
