// src/app/admin/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Types that match the select below ---------- */
type Point = { id: string; name: string | null };
type OperatorRow = { id: string; name: string | null };
type VehicleRow = { id: string; name: string | null; operator: OperatorRow | null };

type RouteRow = {
  id: string;
  route_name: string | null;
  pickup_time: string | null;
  pickup: Point | null;
  destination: Point | null;
};

type JourneyRow = { id: string; departure_ts: string | null; route_id: string | null };

type BookingRow = {
  id: string;
  seats: number | null;
  customer_name: string | null;
  created_at: string | null;
  vehicle: VehicleRow | null;
  journey: JourneyRow | null;
  route: RouteRow | null;
};

type VehicleGroup = {
  vehicleId: string;
  vehicleName: string;
  totalSeats: number;
  items: Array<{
    bookingId: string;
    lead: string;
    seats: number;
    created_at?: string | null;
  }>;
};

type OperatorGroup = {
  operatorName: string;
  totalSeats: number;
  vehicles: VehicleGroup[];
};

type JourneyGroup = {
  journeyId: string;
  departureTs: string | null;
  whenText: string;
  title: string;
  operators: OperatorGroup[];
};

/** Supabase (browser) — guard against missing envs */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb =
  typeof window !== "undefined" && SUPABASE_URL && SUPABASE_ANON
    ? createBrowserClient(SUPABASE_URL, SUPABASE_ANON)
    : null;

function hhmmLocal(hhmm?: string | null) {
  if (!hhmm) return null;
  try {
    const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return hhmm;
  }
}

function fmtWhen(depIso: string | null) {
  if (!depIso) return "—";
  try {
    const dep = new Date(depIso);
    const d = dep.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
    const t = dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${d}, ${t}`;
  } catch {
    return depIso;
  }
}

export default function AdminJourneyBoards(): JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [groups, setGroups] = React.useState<JourneyGroup[]>([]);

  React.useEffect(() => {
    let off = false;

    (async () => {
      if (!sb) {
        setErr("Supabase not configured");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);

      try {
        // Window: upcoming journeys (today → +60 days)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const max = new Date();
        max.setDate(max.getDate() + 60);

        // Bookings that:
        //  - have a vehicle assigned
        //  - belong to active journeys within the window
        const { data, error } = await sb
          .from("bookings")
          .select(
            `
            id, seats, customer_name, created_at,
            vehicle:vehicles (
              id, name,
              operator:operators ( id, name )
            ),
            journey:journeys ( id, departure_ts, route_id ),
            route:routes (
              id, route_name, pickup_time,
              pickup:pickup_points ( id, name ),
              destination:destinations ( id, name )
            )
          `
          )
          .not("vehicle_id", "is", null)
          .eq("journeys.is_active", true)
          .gte("journeys.departure_ts", today.toISOString())
          .lte("journeys.departure_ts", max.toISOString())
          .order("departure_ts", { ascending: true, foreignTable: "journeys" })
          .order("created_at", { ascending: true });

        if (error) throw error;

        const rows: BookingRow[] = (data || []) as any[];

        // Group by journey_id
        const byJourney = new Map<string, BookingRow[]>();
        for (const r of rows) {
          const jId = r.journey?.id;
          if (!jId) continue;
          if (!byJourney.has(jId)) byJourney.set(jId, []);
          byJourney.get(jId)!.push(r);
        }

        const out: JourneyGroup[] = [];

        for (const [jid, items] of byJourney.entries()) {
          const any = items[0];
          const depIso = any?.journey?.departure_ts ?? null;
          const whenText = fmtWhen(depIso);

          const pickup = any?.route?.pickup?.name ?? "—";
          const dest = any?.route?.destination?.name ?? "—";
          const t = `${pickup} → ${dest}`;
          const timeBadge = hhmmLocal(any?.route?.pickup_time);
          const title = timeBadge ? `${t} (${timeBadge})` : t;

          // group by operator → vehicle
          const byOp = new Map<string, Map<string, VehicleGroup>>();

          for (const b of items) {
            const seats = Math.max(1, Number(b.seats ?? 1));
            const operatorName = b.vehicle?.operator?.name ?? "(Unknown operator)";
            const vehicleId = b.vehicle?.id ?? `veh:${b.vehicle?.name ?? "—"}`;
            const vehicleName = b.vehicle?.name ?? "—";

            if (!byOp.has(operatorName)) byOp.set(operatorName, new Map());
            const opMap = byOp.get(operatorName)!;

            if (!opMap.has(vehicleId)) {
              opMap.set(vehicleId, {
                vehicleId,
                vehicleName,
                totalSeats: 0,
                items: [],
              });
            }
            const vg = opMap.get(vehicleId)!;

            vg.items.push({
              bookingId: (b.id || "").slice(0, 8),
              lead: b.customer_name ?? "Guest",
              seats,
              created_at: b.created_at,
            });
            vg.totalSeats += seats;
          }

          // shape + sort
          const operators: OperatorGroup[] = [...byOp.entries()]
            .map(([operatorName, vehicleMap]) => {
              const vehicles: VehicleGroup[] = [...vehicleMap.values()]
                .sort((a, b) => a.vehicleName.localeCompare(b.vehicleName))
                .map((v) => ({
                  ...v,
                  items: v.items.sort((a, b) =>
                    (a.created_at || "").localeCompare(b.created_at || "")
                  ),
                }));
              const totalSeats = vehicles.reduce((s, v) => s + v.totalSeats, 0);
              return { operatorName, totalSeats, vehicles };
            })
            .sort((a, b) => a.operatorName.localeCompare(b.operatorName));

          out.push({
            journeyId: jid,
            departureTs: depIso,
            whenText,
            title,
            operators,
          });
        }

        // sort journeys by actual departure timestamp (fallback to text)
        out.sort((a, b) => {
          const ta = a.departureTs ? Date.parse(a.departureTs) : 0;
          const tb = b.departureTs ? Date.parse(b.departureTs) : 0;
          return ta - tb || a.whenText.localeCompare(b.whenText);
        });

        if (!off) setGroups(out);
      } catch (e: any) {
        if (!off) setErr(e?.message || "Failed to load admin board");
      } finally {
        if (!off) setLoading(false);
      }
    })();

    return () => {
      off = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <h1 className="text-3xl font-bold">Site admin — journey boards</h1>

      {loading && <div className="rounded-2xl border bg-white p-4">Loading…</div>}
      {err && (
        <div className="rounded-2xl border bg-white p-4 text-red-600">
          {err}
        </div>
      )}

      {!loading && !err && groups.length === 0 && (
        <div className="rounded-2xl border bg-white p-4">
          No journeys with assigned vehicles in the selected window.
        </div>
      )}

      {groups.map((g) => (
        <section
          key={g.journeyId}
          className="rounded-2xl border bg-white p-5 shadow space-y-4"
        >
          <div className="text-lg font-semibold">{g.title}</div>
          <div className="text-sm text-neutral-600">{g.whenText}</div>
          <div className="text-sm text-neutral-600">
            Grouped by operator and vehicle — which boats are in play and seat totals.
          </div>

          {g.operators.map((op) => (
            <div key={op.operatorName} className="rounded-xl border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="font-semibold">{op.operatorName}</div>
                <div className="text-xs text-neutral-600">
                  • Total seats: <strong>{op.totalSeats}</strong>
                </div>
              </div>

              {/* Vehicle groups */}
              {op.vehicles.map((v) => (
                    <div
                      key={v.vehicleId}
                      className="rounded-lg border p-3 space-y-2 bg-neutral-50"
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-medium">Vehicle: {v.vehicleName}</div>
                        <div className="text-xs text-neutral-600">
                          • Seats: <strong>{v.totalSeats}</strong>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {v.items.map((b) => (
                          <div
                            key={`${v.vehicleId}-${b.bookingId}`}
                            className="rounded-md border bg-white p-2 flex items-center gap-2 text-sm"
                          >
                            <span className="rounded-full bg-black text-white px-2 py-0.5 text-xs">
                              Lead
                            </span>
                            <span className="font-medium">{b.lead}</span>
                            <span className="opacity-60">•</span>
                            <span>Seats: {b.seats}</span>
                            <span className="ml-auto opacity-40 text-xs">{b.bookingId}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
