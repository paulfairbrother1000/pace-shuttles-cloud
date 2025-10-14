// src/app/operator/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------------- Supabase (browser) ---------------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------------- Types ---------------- */
type UUID = string;

type PsUser = {
  id?: string;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  site_admin?: boolean | null;
};

type JourneyRow = {
  id: UUID;
  route_id: UUID;
  route_name: string;
  pickup_name: string;
  destination_name: string;
  vehicle_id: UUID | null;
  vehicle_name: string | null;
  operator_id: UUID | null;
  operator_name: string | null;
  departure_ts: string; // ISO timestamptz
  is_active: boolean;
  booked: number; // seats booked
  capacity: number; // seats capacity from vehicle
  // crew
  lead_staff_id: UUID | null;
  lead_staff_name: string | null; // "Captain Birdmuck"
};

function readPsUserLocal(): PsUser | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}

/* ---------------- Helpers ---------------- */
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tMinusBadge(iso: string): { label: string; tone: "prep" | "confirmed" } {
  const now = Date.now();
  const dep = new Date(iso).getTime();
  const diffHrs = (dep - now) / (1000 * 60 * 60);

  if (diffHrs <= 24) return { label: "T-24 (Confirmed)", tone: "confirmed" };
  if (diffHrs <= 72) return { label: "T-72 (Confirmed)", tone: "confirmed" };
  return { label: ">72h (Prep)", tone: "prep" };
}

function classNames(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

/* ---------------- Page ---------------- */
export default function OperatorAdminPage() {
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [rows, setRows] = useState<JourneyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ps_user from localStorage (already set during login)
  useEffect(() => {
    setPsUser(readPsUserLocal());
  }, []);

  // Load journeys scoped to operator
  useEffect(() => {
    if (!sb || !psUser?.operator_id) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Expect a view that already joins what we need; fallback to manual join
        // Replace 'ops_journey_board_v' with your real view name if different.
        const { data, error } = await sb
          .from("ops_journey_board_v")
          .select(
            `
            id,
            route_id,
            route_name,
            pickup_name,
            destination_name,
            vehicle_id,
            vehicle_name,
            operator_id,
            operator_name,
            departure_ts,
            is_active,
            booked,
            capacity,
            lead_staff_id,
            lead_staff_name
          `
          )
          .eq("operator_id", psUser.operator_id)
          .order("departure_ts", { ascending: true })
          .limit(200);

        if (error) throw error;
        setRows((data as JourneyRow[]) ?? []);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load journeys");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [psUser?.operator_id, refreshTick]);

  const upcoming = useMemo(
    () => rows.filter((r) => new Date(r.departure_ts).getTime() > Date.now()),
    [rows]
  );

  const needsAssignment = useMemo(
    () =>
      upcoming.filter(
        (r) => !r.vehicle_id || r.capacity <= 0 || !r.lead_staff_id
      ),
    [upcoming]
  );

  /* ---------------- Actions -> /api/ops/* ---------------- */
  async function apiPost(path: string, body: any) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json().catch(() => ({}));
  }

  const doRecalc = async (j: JourneyRow) => {
    await apiPost("/api/ops/recalculate", { journeyId: j.id });
    setRefreshTick((x) => x + 1);
  };

  const doManifest = async (j: JourneyRow) => {
    await apiPost("/api/ops/manifest", { journeyId: j.id });
    setRefreshTick((x) => x + 1);
  };

  const doChangeVehicle = async (j: JourneyRow) => {
    // Basic prompt flow; replace with proper modal if you prefer
    const vehicleId = prompt("Enter new vehicle UUID for this journey:", j.vehicle_id ?? "");
    if (!vehicleId) return;
    await apiPost("/api/ops/change-vehicle", { journeyId: j.id, vehicleId });
    setRefreshTick((x) => x + 1);
  };

  const doRemoveJourney = async (j: JourneyRow) => {
    if (!confirm("Remove this journey from the board?")) return;
    await apiPost("/api/ops/remove-journey", { journeyId: j.id });
    setRefreshTick((x) => x + 1);
  };

  /* ---------------- UI ---------------- */
  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      {/* Title */}
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Operator dashboard — journey board</h1>
        {psUser?.operator_name && (
          <p className="text-sm text-neutral-600">Operator: {psUser.operator_name}</p>
        )}
      </header>

      {/* Refresh */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-neutral-600">
          {loading ? "Loading…" : `${upcoming.length} item(s)`}
        </span>
        <button
          className="rounded-md border px-3 py-1 text-sm hover:bg-neutral-50"
          onClick={() => setRefreshTick((x) => x + 1)}
        >
          Refresh
        </button>
      </div>

      {/* Errors */}
      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* SECTION 1: Upcoming journeys (single column always) */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Upcoming journeys</h2>

        {loading && (
          <div className="rounded-md border p-4 text-sm text-neutral-600">Loading…</div>
        )}

        {!loading && upcoming.length === 0 && (
          <div className="rounded-md border p-4 text-sm text-neutral-600">
            No upcoming journeys.
          </div>
        )}

        <ul className="space-y-3">
          {upcoming.map((j) => {
            const t = tMinusBadge(j.departure_ts);
            const capacityText = `${j.booked}/${j.capacity}`;
            const needsCrew = !j.lead_staff_id;
            return (
              <li key={j.id} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {j.pickup_name} → {j.destination_name}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {fmtDateTime(j.departure_ts)} • Vehicle:{" "}
                        {j.vehicle_name ?? "—"}
                      </p>
                    </div>

                    <div
                      className={classNames(
                        "shrink-0 rounded-md px-2 py-1 text-xs",
                        t.tone === "confirmed"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-neutral-100 text-neutral-700"
                      )}
                      title="Departure window"
                    >
                      {t.label}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {needsCrew ? (
                        <span className="text-xs text-blue-700 underline">Needs crew</span>
                      ) : (
                        <span className="text-xs text-neutral-700">
                          {j.lead_staff_name}
                        </span>
                      )}
                    </div>

                    <div
                      className={classNames(
                        "text-xs",
                        j.booked > j.capacity ? "text-red-600" : "text-neutral-700"
                      )}
                    >
                      {capacityText}
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      className="rounded-md border px-2.5 py-1 text-xs hover:bg-neutral-50"
                      onClick={() => doManifest(j)}
                    >
                      Manifest
                    </button>
                    <button
                      className="rounded-md border px-2.5 py-1 text-xs hover:bg-neutral-50"
                      onClick={() => doChangeVehicle(j)}
                    >
                      Change vehicle
                    </button>
                    <button
                      className="rounded-md border px-2.5 py-1 text-xs hover:bg-neutral-50"
                      onClick={() => doRecalc(j)}
                    >
                      Recalculate
                    </button>
                    <button
                      className="rounded-md border px-2.5 py-1 text-xs hover:bg-neutral-50"
                      onClick={() => doRemoveJourney(j)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* SECTION 2: Journeys needing assignment (still single column, below) */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Journeys needing assignment</h2>

        {needsAssignment.length === 0 ? (
          <div className="rounded-md border p-4 text-sm text-neutral-600">
            All set — no gaps.
          </div>
        ) : (
          <ul className="space-y-3">
            {needsAssignment.map((j) => (
              <li key={j.id} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {j.pickup_name} → {j.destination_name}
                    </p>
                    <p className="text-xs text-neutral-600">
                      {fmtDateTime(j.departure_ts)} •{" "}
                      {!j.vehicle_id ? "No vehicle" : `Vehicle: ${j.vehicle_name}`}
                      {" • "}
                      {!j.lead_staff_id ? "No captain" : `Lead: ${j.lead_staff_name}`}
                    </p>
                  </div>
                  <button
                    className="shrink-0 rounded-md border px-2.5 py-1 text-xs hover:bg-neutral-50"
                    onClick={() => doRecalc(j)}
                    title="Try auto-assign again"
                  >
                    Auto-assign
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
