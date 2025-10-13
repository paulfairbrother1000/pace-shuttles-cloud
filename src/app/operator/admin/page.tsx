# Overwrite the previous file with an updated version that restores operator resolution
# and adds an operator picker fallback if ps_user isn't present, to avoid a "dead" page.
from textwrap import dedent

code = dedent("""\
// src/app/operator/admin/page.tsx
\"use client\";

import { useEffect, useMemo, useState, useCallback } from \"react\";
import { createBrowserClient } from \"@supabase/ssr\";

/**
 * Operator Admin — Boat & Captain Assignment (with operator-picker fallback)
 * - Resolves operator context in this order:
 *   1) localStorage.ps_user
 *   2) Supabase auth user -> ps_user_v view (operator_admin/site_admin mapping)
 *   3) Manual operator picker (writes ps_user to localStorage)
 * - Journeys list + auto/manual boat assignment + lead captain assignment
 * - RPC-first with safe direct update fallback (respect your RLS in prod)
 */

// ---------------------------------------------
// Supabase client (browser only)
// ---------------------------------------------
const sb =
  typeof window !== \"undefined\" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

// ---------------------------------------------
// Types
// ---------------------------------------------
type UUID = string;

type PsUser = {
  id?: string;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  site_admin?: boolean | null;
};

type Operator = { id: UUID; name: string; active?: boolean | null };

type Journey = {
  id: UUID;
  route_id: UUID;
  departure_ts: string;
  is_active: boolean | null;
  assigned_vehicle_id: UUID | null;
  lead_staff_id: UUID | null;
  pax_count?: number | null;
};

type Route = { id: UUID; pickup_id: UUID; destination_id: UUID };
type Location = { id: UUID; name: string };

type Vehicle = {
  id: UUID;
  name: string;
  active: boolean | null;
  minseats: number | null;
  maxseats: number | null;
  operator_id: UUID | null;
};

type Staff = {
  id: UUID;
  operator_id: UUID | null;
  first_name: string | null;
  last_name: string | null;
  jobrole: string | null;
  status: string | null;
};

type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean | null; preferred: boolean | null };

type Toast = { id: string; kind: \"success\" | \"error\" | \"info\"; msg: string };

// ---------------------------------------------
// Utilities
// ---------------------------------------------
function readPsUserLocal(): PsUser | null {
  try {
    const raw = localStorage.getItem(\"ps_user\");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}
function writePsUserLocal(p: PsUser | null) {
  try {
    if (p) localStorage.setItem(\"ps_user\", JSON.stringify(p));
    else localStorage.removeItem(\"ps_user\");
  } catch {}
}
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: \"short\",
    day: \"2-digit\",
    month: \"short\",
    hour: \"2-digit\",
    minute: \"2-digit\",
  });
const fullName = (s?: Staff | null) => {
  if (!s) return \"—\";
  const f = s.first_name ?? \"\";
  const l = s.last_name ?? \"\";
  const full = `${f} ${l}`.trim();
  return full || \"Unnamed\";
};
const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(\" \" );

// ---------------------------------------------
// Data access
// ---------------------------------------------
async function fetchOperatorsList(): Promise<Operator[]> {
  if (!sb) return [];
  const { data, error } = await sb.from(\"operators\").select(\"id,name,active\").order(\"name\");
  if (error) throw error;
  return (data ?? []) as Operator[];
}
async function fetchOperatorById(operatorId: UUID): Promise<Operator | null> {
  if (!sb) return null;
  const { data, error } = await sb.from(\"operators\").select(\"id,name\").eq(\"id\", operatorId).maybeSingle();
  if (error) throw error;
  return data as Operator | null;
}
async function resolvePsUserFromAuth(): Promise<PsUser | null> {
  if (!sb) return null;
  const { data: auth } = await sb.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  // Prefer a view mapping auth.uid() -> operator/site_admin flags
  const viewCandidates = [\"ps_user_v\", \"ps_users_v\", \"profiles_operator_v\"];
  for (const view of viewCandidates) {
    const { data, error } = await sb.from(view)
      .select(\"operator_admin, operator_id, operator_name, site_admin\")
      .eq(\"auth_user_id\", uid)
      .maybeSingle();
    if (!error && data) {
      return { id: uid, ...data };
    }
  }
  return { id: uid, operator_admin: null, operator_id: null, operator_name: null, site_admin: null };
}

async function fetchUpcomingJourneys(operatorId: UUID, fromISO?: string, toISO?: string): Promise<Journey[]> {
  if (!sb) return [];
  // Try operator-scoped view first
  let q = sb
    .from(\"journeys_operator_v\")
    .select(\"id,route_id,departure_ts,is_active,assigned_vehicle_id,lead_staff_id,pax_count\")
    .eq(\"operator_id\", operatorId)
    .gte(\"departure_ts\", fromISO ?? new Date().toISOString());
  if (toISO) q = q.lte(\"departure_ts\", toISO);
  const tryView = await q.order(\"departure_ts\", { ascending: true }).limit(500);
  if (!tryView.error) return (tryView.data ?? []) as Journey[];

  // Fallback
  let jq = sb
    .from(\"journeys\")
    .select(\"id,route_id,departure_ts,is_active,assigned_vehicle_id,lead_staff_id\")
    .gte(\"departure_ts\", fromISO ?? new Date().toISOString());
  if (toISO) jq = jq.lte(\"departure_ts\", toISO);
  const fb = await jq.order(\"departure_ts\", { ascending: true }).limit(500);
  if (fb.error) throw fb.error;
  return (fb.data ?? []) as Journey[];
}
async function fetchRoutes(routeIds: UUID[]) {
  if (!sb || routeIds.length === 0) return new Map<UUID, Route>();
  const { data, error } = await sb.from(\"routes\").select(\"id,pickup_id,destination_id\").in(\"id\", routeIds);
  if (error) throw error;
  return new Map((data ?? []).map((r: Route) => [r.id, r]));
}
async function fetchLocations(locationIds: UUID[]) {
  if (!sb || locationIds.length === 0) return new Map<UUID, Location>();
  const { data, error } = await sb.from(\"locations\").select(\"id,name\").in(\"id\", locationIds);
  if (error) throw error;
  return new Map((data ?? []).map((l: Location) => [l.id, l]));
}
async function fetchOperatorVehicles(operatorId: UUID) {
  if (!sb) return [];
  const { data, error } = await sb
    .from(\"vehicles\")
    .select(\"id,name,active,minseats,maxseats,operator_id\")
    .eq(\"operator_id\", operatorId)
    .eq(\"active\", true)
    .order(\"name\");
  if (error) throw error;
  return (data ?? []) as Vehicle[];
}
async function fetchCaptains(operatorId: UUID) {
  if (!sb) return [];
  const { data, error } = await sb
    .from(\"staff\")
    .select(\"id,operator_id,first_name,last_name,jobrole,status\")
    .eq(\"operator_id\", operatorId)
    .eq(\"status\", \"active\");
  if (error) throw error;
  const rows = (data ?? []) as Staff[];
  return rows.filter((r) => (r.jobrole ?? \"\").toLowerCase().includes(\"captain\"));
}
async function fetchRVAForRoutes(routeIds: UUID[]) {
  if (!sb || routeIds.length === 0) return [] as RVA[];
  const { data, error } = await sb
    .from(\"route_vehicle_assignments\")
    .select(\"route_id,vehicle_id,is_active,preferred\")
    .in(\"route_id\", routeIds)
    .eq(\"is_active\", true);
  if (error) throw error;
  return (data ?? []) as RVA[];
}

// RPCs
async function rpcAssignBoatAuto(journeyId: UUID) {
  if (!sb) throw new Error(\"No Supabase client\");
  const { data, error } = await sb.rpc(\"ops_assign_boat_auto\", { p_journey_id: journeyId });
  if (!error) return data;
  return null;
}
async function rpcAssignBoatManual(journeyId: UUID, vehicleId: UUID) {
  if (!sb) throw new Error(\"No Supabase client\");
  const { data, error } = await sb.rpc(\"ops_assign_boat_manual\", { p_journey_id: journeyId, p_vehicle_id: vehicleId });
  if (!error) return data;
  return null;
}
async function rpcAssignLeadCaptain(journeyId: UUID, staffId: UUID) {
  if (!sb) throw new Error(\"No Supabase client\");
  const { data, error } = await sb.rpc(\"ops_assign_lead\", { p_journey_id: journeyId, p_staff_id: staffId });
  if (!error) return data;
  return null;
}
async function directUpdateJourney(journeyId: UUID, patch: Partial<Pick<Journey, \"assigned_vehicle_id\" | \"lead_staff_id\">>) {
  if (!sb) throw new Error(\"No Supabase client\");
  const { error } = await sb.from(\"journeys\").update(patch).eq(\"id\", journeyId);
  if (error) throw error;
}

// eligibility helpers
function eligibleVehiclesForJourney(j: Journey, rvas: RVA[], vehicles: Vehicle[]) {
  const allowed = new Set(rvas.filter((x) => x.route_id === j.route_id && x.is_active).map((x) => x.vehicle_id));
  return vehicles.filter((v) => allowed.has(v.id));
}
function preferredVehicleIdsForJourney(j: Journey, rvas: RVA[]) {
  return new Set(rvas.filter((x) => x.route_id === j.route_id && x.is_active && x.preferred).map((x) => x.vehicle_id));
}

// ---------------------------------------------
// Component
// ---------------------------------------------
export default function OperatorAdminPage() {
  // Operator context
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const [operator, setOperator] = useState<Operator | null>(null);
  const [operatorsAll, setOperatorsAll] = useState<Operator[]>([]);
  const [pickOperatorId, setPickOperatorId] = useState<string>(\"\");

  // Data
  const [loading, setLoading] = useState(true);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [routesById, setRoutesById] = useState<Map<UUID, Route>>(new Map());
  const [locById, setLocById] = useState<Map<UUID, Location>>(new Map());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [captains, setCaptains] = useState<Staff[]>([]);
  const [rvas, setRvas] = useState<RVA[]>([]);

  // Filters
  const [fromISO, setFromISO] = useState<string>(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d.toISOString();
  });
  const [toISO, setToISO] = useState<string | undefined>(undefined);

  // UI
  const [pending, setPending] = useState<Record<UUID, boolean>>({});
  const [selVehicle, setSelVehicle] = useState<Record<UUID, UUID | \"\">>({});
  const [selCaptain, setSelCaptain] = useState<Record<UUID, UUID | \"\">>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((t: Toast) => {
    setToasts((prev) => [...prev, t]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 3500);
  }, []);

  // Resolve operator context
  useEffect(() => {
    (async () => {
      // 1) localStorage
      const fromLocal = readPsUserLocal();
      if (fromLocal?.operator_id) {
        setPsUser(fromLocal);
        return;
      }
      // 2) auth -> ps_user_v (if available)
      const fromAuth = await resolvePsUserFromAuth();
      if (fromAuth?.operator_id) {
        setPsUser(fromAuth);
        writePsUserLocal(fromAuth);
        return;
      }
      // 3) no context — allow manual pick
      const ops = await fetchOperatorsList();
      setOperatorsAll(ops);
    })();
  }, []);

  // Load operator data when we have context
  const loadData = useCallback(async (_operatorId: UUID, _from?: string, _to?: string) => {
    const op = await fetchOperatorById(_operatorId);
    setOperator(op);

    const js = await fetchUpcomingJourneys(_operatorId, _from, _to);
    setJourneys(js);

    const routeIds = Array.from(new Set(js.map((j) => j.route_id)));
    const routes = await fetchRoutes(routeIds);
    setRoutesById(routes);

    const locIds = Array.from(new Set(Array.from(routes.values()).flatMap((r) => [r.pickup_id, r.destination_id])));
    const locs = await fetchLocations(locIds);
    setLocById(locs);

    const vs = await fetchOperatorVehicles(_operatorId);
    setVehicles(vs);

    const caps = await fetchCaptains(_operatorId);
    setCaptains(caps);

    const rva = await fetchRVAForRoutes(routeIds);
    setRvas(rva);
  }, []);

  useEffect(() => {
    (async () => {
      if (!psUser?.operator_id) { setLoading(false); return; }
      try {
        setLoading(true);
        await loadData(psUser.operator_id as UUID, fromISO, toISO);
      } catch (e: any) {
        toast({ id: crypto.randomUUID(), kind: \"error\", msg: e?.message ?? \"Load failed\" });
      } finally {
        setLoading(false);
      }
    })();
  }, [psUser?.operator_id, fromISO, toISO, loadData, toast]);

  // Memos
  const vehiclesById = useMemo(() => new Map(vehicles.map((v) => [v.id, v] as const)), [vehicles]);
  const captainsById = useMemo(() => new Map(captains.map((c) => [c.id, c] as const)), [captains]);
  function journeyLabel(j: Journey) {
    const r = routesById.get(j.route_id);
    if (!r) return \"Route\";
    const pk = locById.get(r.pickup_id)?.name ?? \"Pickup\";
    const dt = locById.get(r.destination_id)?.name ?? \"Destination\";
    return `${pk} → ${dt}`;
  }

  // Actions
  async function handleAutoAssignBoat(j: Journey) {
    setPending((p) => ({ ...p, [j.id]: true }));
    try {
      const rpc = await rpcAssignBoatAuto(j.id);
      if (!rpc) {
        const elig = eligibleVehiclesForJourney(j, rvas, vehicles);
        const pref = preferredVehicleIdsForJourney(j, rvas);
        const pick = elig.find((v) => pref.has(v.id))?.id ?? elig[0]?.id ?? null;
        if (!pick) throw new Error(\"No eligible boats for this route.\");
        await directUpdateJourney(j.id, { assigned_vehicle_id: pick });
        setJourneys((arr) => arr.map((x) => (x.id === j.id ? { ...x, assigned_vehicle_id: pick } : x)));
      } else if (rpc?.vehicle_id) {
        setJourneys((arr) => arr.map((x) => (x.id === j.id ? { ...x, assigned_vehicle_id: rpc.vehicle_id } : x)));
      }
      toast({ id: crypto.randomUUID(), kind: \"success\", msg: \"Boat assigned.\" });
    } catch (e: any) {
      toast({ id: crypto.randomUUID(), kind: \"error\", msg: e?.message ?? \"Failed to auto-assign boat\" });
    } finally {
      setPending((p) => ({ ...p, [j.id]: false }));
    }
  }
  async function handleManualAssignBoat(j: Journey) {
    const v = (selVehicle[j.id] ?? \"\") as UUID | \"\";
    if (!v) { toast({ id: crypto.randomUUID(), kind: \"info\", msg: \"Pick a boat first.\" }); return; }
    setPending((p) => ({ ...p, [j.id]: true }));
    try {
      const rpc = await rpcAssignBoatManual(j.id, v as UUID);
      if (!rpc) await directUpdateJourney(j.id, { assigned_vehicle_id: v as UUID });
      setJourneys((arr) => arr.map((x) => (x.id === j.id ? { ...x, assigned_vehicle_id: v as UUID } : x)));
      toast({ id: crypto.randomUUID(), kind: \"success\", msg: \"Boat updated.\" });
    } catch (e: any) {
      toast({ id: crypto.randomUUID(), kind: \"error\", msg: e?.message ?? \"Failed to set boat\" });
    } finally {
      setPending((p) => ({ ...p, [j.id]: false }));
    }
  }
  async function handleAssignCaptain(j: Journey) {
    const c = (selCaptain[j.id] ?? \"\") as UUID | \"\";
    if (!c) { toast({ id: crypto.randomUUID(), kind: \"info\", msg: \"Pick a captain first.\" }); return; }
    setPending((p) => ({ ...p, [j.id]: true }));
    try {
      const rpc = await rpcAssignLeadCaptain(j.id, c as UUID);
      if (!rpc) await directUpdateJourney(j.id, { lead_staff_id: c as UUID });
      setJourneys((arr) => arr.map((x) => (x.id === j.id ? { ...x, lead_staff_id: c as UUID } : x)));
      toast({ id: crypto.randomUUID(), kind: \"success\", msg: \"Lead captain set.\" });
    } catch (e: any) {
      toast({ id: crypto.randomUUID(), kind: \"error\", msg: e?.message ?? \"Failed to set captain\" });
    } finally {
      setPending((p) => ({ ...p, [j.id]: false }));
    }
  }

  // Header
  function Header() {
    return (
      <div className=\"mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between\">
        <div>
          <h1 className=\"text-2xl font-semibold\">Operator Admin</h1>
          <p className=\"text-sm text-neutral-600\">
            {operator ? <>Operator: <span className=\"font-medium\">{operator.name}</span></> : \"No operator context found\"}
          </p>
        </div>
        <div className=\"flex gap-2\">
          <button onClick={() => location.reload()} className=\"rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50\">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Operator picker (fallback if ps_user missing)
  function OperatorPicker() {
    return (
      <div className=\"rounded-xl border p-4\">
        <p className=\"mb-3 text-sm text-neutral-700\">
          No operator context found. Select an operator to continue.
        </p>
        <div className=\"flex flex-col gap-3 sm:flex-row sm:items-center\">
          <select
            className=\"w-full rounded-lg border px-3 py-2 text-sm sm:w-80\"
            value={pickOperatorId}
            onChange={(e) => setPickOperatorId(e.target.value)}
          >
            <option value=\"\">— Choose operator —</option>
            {operatorsAll.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button
            disabled={!pickOperatorId}
            className={cx(\"rounded-lg border px-3 py-2 text-sm\", !pickOperatorId ? \"opacity-60\" : \"hover:bg-neutral-50\")}
            onClick={async () => {
              if (!pickOperatorId) return;
              const chosen = operatorsAll.find((o) => o.id === pickOperatorId);
              const next: PsUser = {
                id: undefined,
                operator_admin: true,
                operator_id: pickOperatorId,
                operator_name: chosen?.name ?? null,
                site_admin: null,
              };
              writePsUserLocal(next);
              setPsUser(next);
            }}
          >
            Use this operator
          </button>
        </div>
      </div>
    );
  }

  // Row controls
  function RowAssignControls({ j }: { j: Journey }) {
    const elig = useMemo(() => eligibleVehiclesForJourney(j, rvas, vehicles), [j, rvas, vehicles]);
    const preferred = useMemo(() => preferredVehicleIdsForJourney(j, rvas), [j, rvas]);
    const assigned = j.assigned_vehicle_id ? vehiclesById.get(j.assigned_vehicle_id) : null;
    const lead = j.lead_staff_id ? captainsById.get(j.lead_staff_id) : null;

    return (
      <div className=\"grid grid-cols-1 gap-3 md:grid-cols-3\">
        <div className=\"flex items-center gap-2\">
          <select
            className=\"w-full rounded-lg border px-3 py-2 text-sm\"
            value={selVehicle[j.id] ?? j.assigned_vehicle_id ?? \"\"}
            onChange={(e) => setSelVehicle((m) => ({ ...m, [j.id]: (e.target.value || \"\") as UUID | \"\" }))}
          >
            <option value=\"\">— Select boat —</option>
            {elig.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{preferred.has(v.id) ? \" ★\" : \"\"}</option>
            ))}
          </select>
          <button onClick={() => handleManualAssignBoat(j)} disabled={!!pending[j.id]} className={cx(\"rounded-lg border px-3 py-2 text-sm\", pending[j.id] ? \"opacity-60\" : \"hover:bg-neutral-50\")}>
            Set
          </button>
          <button onClick={() => handleAutoAssignBoat(j)} disabled={!!pending[j.id]} className={cx(\"rounded-lg border px-3 py-2 text-sm\", pending[j.id] ? \"opacity-60\" : \"hover:bg-neutral-50\")}>
            Auto
          </button>
        </div>

        <div className=\"flex items-center gap-2\">
          <select
            className=\"w-full rounded-lg border px-3 py-2 text-sm\"
            value={selCaptain[j.id] ?? j.lead_staff_id ?? \"\"}
            onChange={(e) => setSelCaptain((m) => ({ ...m, [j.id]: (e.target.value || \"\") as UUID | \"\" }))}
          >
            <option value=\"\">— Lead captain —</option>
            {captains.map((c) => (<option key={c.id} value={c.id}>{fullName(c)}</option>))}
          </select>
          <button onClick={() => handleAssignCaptain(j)} disabled={!!pending[j.id]} className={cx(\"rounded-lg border px-3 py-2 text-sm\", pending[j.id] ? \"opacity-60\" : \"hover:bg-neutral-50\")}>
            Set
          </button>
        </div>

        <div className=\"text-sm text-neutral-700\">
          <div><span className=\"text-neutral-500\">Boat:</span> <span className=\"font-medium\">{assigned?.name ?? \"—\"}</span></div>
          <div><span className=\"text-neutral-500\">Captain:</span> <span className=\"font-medium\">{fullName(lead ?? null)}</span></div>
          {typeof j.pax_count === \"number\" && (<div><span className=\"text-neutral-500\">Passengers:</span> <span className=\"font-medium\">{j.pax_count}</span></div>)}
        </div>
      </div>
    );
  }

  // Render
  return (
    <main className=\"mx-auto max-w-6xl p-6\">
      <div className=\"mb-6 flex items-baseline justify-between\">
        <div>
          <h1 className=\"text-2xl font-semibold\">Operator Admin</h1>
          <p className=\"text-sm text-neutral-600\">
            {operator ? <>Operator: <span className=\"font-medium\">{operator.name}</span></> : \"No operator context found\"}
          </p>
        </div>
        <button onClick={() => location.reload()} className=\"rounded-xl border px-3 py-2 text-sm hover:bg-neutral-50\">Refresh</button>
      </div>

      {/* Toasts */}
      <div className=\"fixed right-4 top-4 z-50 flex w-80 flex-col gap-2\">
        {toasts.map((t) => (
          <div key={t.id} className={cx(\"rounded-xl border px-3 py-2 text-sm shadow-sm\", t.kind === \"success\" && \"border-green-200 bg-green-50\", t.kind === \"error\" && \"border-red-200 bg-red-50\", t.kind === \"info\" && \"border-neutral-200 bg-white\")}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* If no operator context, show picker and stop */}
      {!psUser?.operator_id ? (
        <OperatorPicker />
      ) : (
        <>
          {/* Filters */}
          <div className=\"mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3\">
            <label className=\"text-sm\">
              <span className=\"mb-1 block text-neutral-600\">From</span>
              <input
                type=\"datetime-local\"
                className=\"w-full rounded-lg border px-3 py-2 text-sm\"
                value={toLocalInputValue(fromISO)}
                onChange={(e) => {
                  const v = e.target.value ? new Date(e.target.value) : new Date();
                  setFromISO(new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString());
                }}
              />
            </label>
            <label className=\"text-sm\">
              <span className=\"mb-1 block text-neutral-600\">To (optional)</span>
              <input
                type=\"datetime-local\"
                className=\"w-full rounded-lg border px-3 py-2 text-sm\"
                value={toLocalInputValue(toISO)}
                onChange={(e) => {
                  const v = e.target.value ? new Date(e.target.value) : undefined;
                  setToISO(v ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString() : undefined);
                }}
              />
            </label>
            <div className=\"flex items-end\">
              <button
                onClick={() => psUser?.operator_id && loadData(psUser.operator_id as UUID, fromISO, toISO)}
                className=\"w-full rounded-lg border px-3 py-2 text-sm hover:bg-neutral-50\"
              >
                Apply
              </button>
            </div>
          </div>

          <div className=\"overflow-x-auto rounded-xl border\">
            <table className=\"w-full text-sm\">
              <thead className=\"bg-neutral-50\">
                <tr>
                  <th className=\"p-3 text-left\">When</th>
                  <th className=\"p-3 text-left\">Route</th>
                  <th className=\"p-3 text-left\">Assign</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className=\"p-6 text-center text-neutral-500\">Loading journeys…</td></tr>
                ) : journeys.length === 0 ? (
                  <tr><td colSpan={3} className=\"p-6 text-center text-neutral-500\">No upcoming journeys for this operator in the selected range.</td></tr>
                ) : (
                  journeys.map((j) => (
                    <tr key={j.id} className=\"border-t align-top\">
                      <td className=\"whitespace-nowrap p-3\">{fmtTime(j.departure_ts)}</td>
                      <td className=\"p-3\">
                        <div className=\"font-medium\">{journeyLabel(j)}</div>
                        <div className=\"text-xs text-neutral-500\">Journey ID: {j.id}</div>
                      </td>
                      <td className=\"p-3\"><RowAssignControls j={j} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className=\"mt-3 text-xs text-neutral-500\">
            Tip: “Auto” picks a preferred boat for the route if available; otherwise the first eligible boat.
          </p>
        </>
      )}
    </main>
  );
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function toLocalInputValue(iso?: string) {
  if (!iso) return \"\";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, \"0\");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
""")

path = "/mnt/data/operator-admin-page-v2.tsx"
with open(path, "w", encoding="utf-8") as f:
    f.write(code)

path
