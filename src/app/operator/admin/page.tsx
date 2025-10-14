// /src/app/operator/admin/page.tsx
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

type Horizon = ">72h" | "T72" | "T24" | "past";
function horizonFor(tsISO: string): Horizon {
  const now = Date.now();
  const dep = new Date(tsISO).getTime();
  if (dep <= now) return "past";
  const hours = (dep - now) / 36e5;
  if (hours <= 24) return "T24";
  if (hours <= 72) return "T72";
  return ">72h";
}

function horizonBadge(h: Horizon) {
  if (h === ">72h") return { text: ">72h (Prep)", cls: "bg-gray-100 text-gray-700" };
  if (h === "T72") return { text: "T-72 (Confirmed)", cls: "bg-amber-100 text-amber-800" };
  if (h === "T24") return { text: "T-24 (Finalised)", cls: "bg-rose-100 text-rose-800" };
  return { text: "Past", cls: "bg-gray-100 text-gray-500" };
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
  const [manifestRows, setManifestRows] = React.useState<BookingRow[] | null>(null);
  const [manifestLoading, setManifestLoading] = React.useState(false);
  const [manifestInfo, setManifestInfo] = React.useState<{ title: string; subtitle: string } | null>(null);

  // Lead (captain) cache keyed by journey_id:vehicle_id
  const [leadByJV, setLeadByJV] = React.useState<
    Map<string, { staff_id: string | null; name: string }>
  >(new Map());

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

        // 1) WITH vehicle — disambiguate the route embed
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

        // 3) Sum seats per journey
        const allJourneyIds = [
          ...(jWith?.map((j: any) => j.id) ?? []),
          ...(jNo?.map((j: any) => j.id) ?? []),
        ];

        const byJourneyCount = new Map<string, number>();
        if (allJourneyIds.length > 0) {
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

        // 4b) Bulk-load current lead (captain) per journey+vehicle
        if ((wv ?? []).length > 0) {
          const jids = wv.map((r) => r.id);
          const vids = wv.map((r) => r.vehicle_id);
          const { data: leads, error: eL } = await supabase
            .from("journey_assignments")
            .select("journey_id, vehicle_id, is_lead, staff:staff_id(id,first_name,last_name)")
            .in("journey_id", jids)
            .in("vehicle_id", vids)
            .eq("is_lead", true);
          if (eL) throw eL;
          const map = new Map<string, { staff_id: string | null; name: string }>();
          for (const row of leads ?? []) {
            const key = `${(row as any).journey_id}:${(row as any).vehicle_id}`;
            const st = (row as any).staff || {};
            const name = `${st.first_name ?? ""} ${st.last_name ?? ""}`.trim() || "Needs crew";
            map.set(key, { staff_id: st.id ?? null, name });
          }
          setLeadByJV(map);
        } else {
          setLeadByJV(new Map());
        }

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
    // Guardrail: no changes at/after T-72
    const h = horizonFor(row.departure_ts);
    if (h === "T72" || h === "T24" || h === "past") return false;
    return true;
  }

  async function onRemoveVehicle(row: WithVehicleRow) {
    if (!canRemove(row)) return;

    if (row.booked_seats > 0) {
      const ok = window.confirm(
        `This journey has ${row.booked_seats} booked seat(s).\n\n` +
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

  /** -------- Recalculate (server finalize-allocations) -------- */
  async function recalc(journeyId: string) {
    try {
      const opId = readCachedUser()?.operator_id ?? undefined;
      const body: any = { journey_id: journeyId };
      // Scope to operator if we have one; server keeps “no new boats after T-72”
      if (opId) body.operator_id = opId;

      const res = await fetch("/api/ops/finalize-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Recalculate failed");
      }
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
    setManifestRows(null);
    setManifestLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, customer_name, seats, status")
        .eq("journey_id", journeyId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setManifestRows((data ?? []) as BookingRow[]);
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
    setManifestRows(null);
    setManifestInfo(null);
  }

  /** -------- Captain picker (inline popover) -------- */
  function CaptainPicker({
    journeyId,
    vehicleId,
    current,
    onChanged,
    disabled,
  }: {
    journeyId: string;
    vehicleId: string;
    current: { staff_id: string | null; name: string } | null;
    onChanged: () => void;
    disabled?: boolean;
  }) {
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [list, setList] = React.useState<
      Array<{ id: string; first_name: string | null; last_name: string | null }>
    >([]);
    const [errLocal, setErrLocal] = React.useState<string | null>(null);

    async function load() {
      setLoading(true);
      setErrLocal(null);
      try {
        const { data, error } = await supabase
          .from("staff")
          .select("id,first_name,last_name")
          .eq("active", true)
          .ilike("roles", "%CAPTAIN%")
          .order("first_name", { ascending: true });
        if (error) throw error;
        setList((data ?? []) as any);
      } catch (e: any) {
        setErrLocal(e.message ?? String(e));
        setList([]);
      } finally {
        setLoading(false);
      }
    }
    async function choose(staff_id: string) {
      setErrLocal(null);
      try {
        const res = await fetch("/api/ops/assign-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ journey_id: journeyId, vehicle_id: vehicleId, staff_id }),
        });
        const json = await res.json();
        if (!res.ok || json?.ok === false) throw new Error(json?.error || "Assign failed");
        setOpen(false);
        onChanged();
      } catch (e: any) {
        setErrLocal(e.message ?? String(e));
      }
    }

    return (
      <div className="relative inline-block">
        <button
          className={classNames("text-blue-600 hover:underline disabled:opacity-50")}
          disabled={disabled}
          onClick={() => {
            if (!open) load();
            setOpen((o) => !o);
          }}
          title={disabled ? "Captain changes disabled at/after T-72" : "Assign / replace captain"}
        >
          {current?.name || "Needs crew"}
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-64 rounded-md border bg-white shadow">
            {loading ? (
              <div className="p-2 text-sm text-gray-600">Loading…</div>
            ) : (list ?? []).length === 0 ? (
              <div className="p-2 text-sm text-gray-600">No captains found.</div>
            ) : (
              <ul className="max-h-64 overflow-auto">
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => choose(s.id)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      {(s.first_name ?? "") + " " + (s.last_name ?? "")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errLocal && <div className="border-t p-2 text-xs text-red-600">{errLocal}</div>}
          </div>
        )}
      </div>
    );
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
                  const h = horizonFor(row.departure_ts);
                  const hb = horizonBadge(h);
                  const canChangeAtAll = h === ">72h"; // per policy: no changes at/after T-72
                  const leadKey = `${row.id}:${row.vehicle_id}`;
                  const lead = leadByJV.get(leadKey) ?? { staff_id: null, name: "Needs crew" };

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
                          <div className="ml-3 flex items-center gap-2">
                            <span className={classNames("rounded-md px-2 py-0.5 text-[11px]", hb.cls)}>{hb.text}</span>
                            <button
                              onClick={() => recalc(row.id)}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                              title="Recalculate with server rules"
                            >
                              Recalculate
                            </button>
                            <div className="shrink-0 text-right">
                              <div className={classNames("text-sm font-semibold", over && "text-red-600")}>
                                {row.booked_seats}/{row.seats_capacity ?? "?"}
                              </div>
                              <div className="text-[11px] text-gray-500 text-right">booked / capacity</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Captain assign/replace */}
                          <CaptainPicker
                            journeyId={row.id}
                            vehicleId={row.vehicle_id}
                            current={lead}
                            onChanged={() => setRefreshKey((x) => x + 1)}
                            disabled={!canChangeAtAll}
                          />

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
                            className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                            title={canChangeAtAll ? "Change vehicle" : "Changes disabled at/after T-72"}
                            disabled={!canChangeAtAll || !canOperate(row.vehicle_operator_id) || !isFuture(row.departure_ts)}
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
                                : "You don’t have permission, it’s past departure, or it’s within T-72"
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
                {needsAssign.map((row) => {
                  const h = horizonFor(row.departure_ts);
                  const hb = horizonBadge(h);
                  const canAssign = h === ">72h"; // cannot invite a new vehicle at/after T-72
                  return (
                    <li key={row.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {row.pickup_name ?? "Pickup"} → {row.destination_name ?? "Destination"}
                          </div>
                          <div className="text-xs text-gray-500">{fmtDate(row.departure_ts)}</div>
                        </div>
                        <div className="ml-3 flex items-center gap-2">
                          <span className={classNames("rounded-md px-2 py-0.5 text-[11px]", hb.cls)}>{hb.text}</span>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold">{row.booked_seats}</div>
                            <div className="text-[11px] text-gray-500">booked seats</div>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => openAssign(row.id)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                          disabled={!canAssign || !canOperate()}
                          title={canAssign ? "Assign vehicle" : "Assignments disabled at/after T-72"}
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
                        <button
                          onClick={() => recalc(row.id)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
                          title="Recalculate with server rules"
                        >
                          Recalculate
                        </button>
                      </div>
                    </li>
                  );
                })}
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
                <div className="text.base font-semibold">Passenger manifest</div>
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
            ) : (manifestRows ?? []).length === 0 ? (
              <div className="mt-4 text-sm text-gray-600">No bookings yet.</div>
            ) : (
              <ul className="mt-4 space-y-2">
                {(manifestRows ?? []).map((b) => (
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
