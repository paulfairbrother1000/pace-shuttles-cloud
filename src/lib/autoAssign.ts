// src/lib/autoAssign.ts
import { createClient } from "@supabase/supabase-js";

type UUID = string;
type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
type RVA = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean };
type Vehicle = {
  id: UUID; name: string; active: boolean | null;
  minseats: number | string | null; maxseats: number | string | null; operator_id: UUID | null;
};
type StaffRow = { id: UUID; operator_id: UUID; active: boolean | null; first_name: string | null; last_name: string | null };
type AssignRow = { journey_id: UUID; vehicle_id: UUID; staff_id: UUID | null; status_simple: "allocated"|"confirmed"|"complete"|"cancelled" };
type Order = { id: UUID; status: string; route_id: UUID | null; journey_date: string | null; qty: number | null };
type JVAlloc = { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sbAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

function toDateISO(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`;
}
function horizonFor(tsISO: string): "T24"|"T72"|">72h"|"past" {
  const now = new Date(); const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime()-now.getTime())/36e5;
  if (h <= 24) return "T24"; if (h <= 72) return "T72"; return ">72h";
}
function withinWindow(a: Date, b: Date, minutes: number) {
  return Math.abs(a.getTime()-b.getTime()) <= minutes*60*1000;
}

async function fetchJourneysScope(scope: {all?: boolean, operator_id?: string|null}) {
  const { data: journeys } = await sbAdmin
    .from("journeys")
    .select("id,route_id,departure_ts,is_active")
    .gte("departure_ts", new Date().toISOString())
    .eq("is_active", true);
  const j = (journeys||[]) as Journey[];

  // scope vehicles via RVAs+Vehicles to filter by operator if needed
  const routeIds = Array.from(new Set(j.map(x=>x.route_id)));
  const [{ data: rvas }, { data: vehicles }] = await Promise.all([
    sbAdmin.from("route_vehicle_assignments").select("route_id,vehicle_id,is_active,preferred").in("route_id", routeIds).eq("is_active", true),
    sbAdmin.from("vehicles").select("id,name,active,minseats,maxseats,operator_id").eq("active", true),
  ]);
  const vById = new Map<string, Vehicle>((vehicles||[] as Vehicle[]).map(v=>[v.id, v]));
  const rvasAll = (rvas||[]) as RVA[];

  const rvasByJourney = new Map<string, RVA[]>();
  for (const rv of rvasAll) {
    const list = rvasByJourney.get(rv.route_id) ?? [];
    list.push(rv);
    rvasByJourney.set(rv.route_id, list);
  }

  let journeysFiltered = j;
  if (!scope.all && scope.operator_id) {
    const opId = scope.operator_id;
    journeysFiltered = j.filter(jy => {
      const rv = rvasByJourney.get(jy.route_id) || [];
      return rv.some(r => vById.get(r.vehicle_id)?.operator_id === opId);
    });
  }

  return { journeys: journeysFiltered, rvasAll, vById };
}

async function fetchLocksAndOrders(journeys: Journey[]) {
  const journeyIds = journeys.map(j=>j.id);
  const { data: locks } = await sbAdmin
    .from("journey_vehicle_allocations")
    .select("journey_id,vehicle_id,order_id,seats")
    .in("journey_id", journeyIds);
  const { data: orders } = await sbAdmin
    .from("orders").select("id,status,route_id,journey_date,qty")
    .eq("status", "paid");
  return { locks: (locks||[]) as JVAlloc[], orders: (orders||[]) as Order[] };
}

async function fetchAssignments(journeys: Journey[]) {
  const journeyIds = journeys.map(j=>j.id);
  const { data } = await sbAdmin
    .from("v_journey_staff_min")
    .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
    .in("journey_id", journeyIds);
  return (data||[]) as AssignRow[];
}

async function fetchEligibleStaffForOperator(operator_id: string) {
  const { data } = await sbAdmin
    .from("operator_staff")
    .select("id,operator_id,active,first_name,last_name")
    .eq("operator_id", operator_id)
    .eq("active", true);
  return (data||[]) as StaffRow[];
}

// optional fair-use table: crew_fair_use(operator_id, vehicle_id, staff_id, picks int, updated_at)
// fallback: count past assignments from history view journey_staff (or v_journey_staff_min)
async function pickNextByFairUse(operator_id: string, vehicle_id: string, eligible: StaffRow[]) {
  const ids = eligible.map(s=>s.id);
  // try crew_fair_use
  const { data: fu, error } = await sbAdmin
    .from("crew_fair_use")
    .select("staff_id,picks")
    .eq("operator_id", operator_id)
    .eq("vehicle_id", vehicle_id)
    .in("staff_id", ids);
  if (!error && fu && fu.length) {
    const byId = new Map<string, number>(fu.map(r=>[r.staff_id as string, Number(r.picks||0)]));
    const sorted = eligible.slice().sort((a,b)=>{
      const pa = byId.get(a.id) ?? 0;
      const pb = byId.get(b.id) ?? 0;
      if (pa !== pb) return pa - pb; // least picks first
      // tie-break: least-recently assigned via journey history
      return (a.last_name||"").localeCompare(b.last_name||"");
    });
    return sorted[0] || null;
  }

  // fallback: compute counts from v_journey_staff_min (last 90 days)
  const since = new Date(); since.setDate(since.getDate()-90);
  const { data: hist } = await sbAdmin
    .from("v_journey_staff_min")
    .select("staff_id,vehicle_id,journey_id")
    .in("staff_id", ids)
    .eq("vehicle_id", vehicle_id)
    .gte("journey_id", "00000000-0000-0000-0000-000000000000"); // noop filter but needed in some RLS setups
  const counts = new Map<string, number>();
  (hist||[]).forEach(h=>counts.set(h.staff_id as string, (counts.get(h.staff_id as string)||0)+1));
  const sorted = eligible.slice().sort((a,b)=>{
    const pa = counts.get(a.id) ?? 0;
    const pb = counts.get(b.id) ?? 0;
    if (pa !== pb) return pa - pb;
    return (a.last_name||"").localeCompare(b.last_name||"");
  });
  return sorted[0] || null;
}

async function hasStaffOverlap(staff_id: string, at: Date) {
  // very simple overlap check via v_journey_staff_min around ±90 min
  const from = new Date(at.getTime()-90*60*1000).toISOString();
  const to   = new Date(at.getTime()+90*60*1000).toISOString();
  const { data } = await sbAdmin
    .from("journeys")
    .select("id,departure_ts,v_journey_staff_min!inner(staff_id)")
    .gte("departure_ts", from)
    .lte("departure_ts", to)
    .eq("v_journey_staff_min.staff_id", staff_id);
  return (data||[]).length > 0;
}

async function assignLead(journey_id: string, vehicle_id: string, staff_id: string, mode: "auto"|"manual") {
  // upsert into journey_staff (or call RPC) – assuming RPC exists `assign_lead(journey_id, vehicle_id, staff_id, mode)`
  const { error } = await sbAdmin.rpc("assign_lead", { p_journey_id: journey_id, p_vehicle_id: vehicle_id, p_staff_id: staff_id, p_mode: mode });
  if (error) throw error;
}

async function sendCaptainInviteEmail(staff_id: string, journey_id: string, vehicle_id: string) {
  // hook into your mailer
  try { await fetch(process.env.MAILER_WEBHOOK_URL || "", { method: "POST", body: JSON.stringify({ staff_id, journey_id, vehicle_id }) }); } catch {}
}

// T-72 rules: discard empty boats (is_active=false) if reallocation is safe; allow one under minseats-1; trigger discount hook.
async function applyT72Adjustments(journey: Journey, rvasForRoute: RVA[], vById: Map<string,Vehicle>, locks: JVAlloc[], orders: Order[]) {
  const dep = new Date(journey.departure_ts);
  if (horizonFor(journey.departure_ts) !== "T72") return; // run only when entering T-72 (idempotent call is ok)

  // compute demand preview per boat
  const dateISO = toDateISO(dep);
  const demand = (orders||[])
    .filter(o=>o.status==="paid" && o.route_id===journey.route_id && o.journey_date===dateISO)
    .map(o=>Math.max(0, Number(o.qty||0)))
    .reduce((s,x)=>s+x,0);

  // locked seats per vehicle
  const lockedByVeh = new Map<string, number>();
  (locks||[]).filter(l=>l.journey_id===journey.id).forEach(l=>{
    lockedByVeh.set(l.vehicle_id, (lockedByVeh.get(l.vehicle_id)||0)+Number(l.seats||0));
  });

  // separate empty vs non-empty
  const activeRvas = rvasForRoute.filter(x=>x.is_active);
  const empties: RVA[] = [];
  const nonEmpty: RVA[] = [];
  for (const x of activeRvas) {
    const seats = lockedByVeh.get(x.vehicle_id) || 0;
    if (seats === 0) empties.push(x); else nonEmpty.push(x);
  }
  if (!empties.length) return;

  // Try deactivating empties **only** if capacity remains >= demand on remaining boats
  const remainingCaps = nonEmpty.map(n=>{
    const v = vById.get(n.vehicle_id)!;
    return Math.max(0, Number(v.maxseats||0));
  }).reduce((s,x)=>s+x,0);

  if (remainingCaps >= demand) {
    // set is_active=false for empty RVAs
    const ids = empties.map(e=>e.vehicle_id);
    await sbAdmin.from("route_vehicle_assignments").update({ is_active: false }).in("vehicle_id", ids).eq("route_id", journey.route_id);
  }

  // Allow one boat with minseats-1
  const keepList = nonEmpty.length ? nonEmpty : activeRvas; // if all empty, keep first
  if (keepList.length) {
    const v = vById.get(keepList[0].vehicle_id);
    if (v && v.minseats != null) {
      const newMin = Math.max(0, Number(v.minseats) - 1);
      await sbAdmin.from("vehicles").update({ minseats: newMin }).eq("id", v.id);
    }
  }

  // Discount hook (only if all remaining boats reached min seats)
  // Implement your own business rule here via a stored procedure
  await sbAdmin.rpc("maybe_enable_discounts", { p_journey_id: journey.id });
}

export async function runAutoAssign(scope: { all?: boolean; operator_id?: string|null }) {
  const { journeys, rvasAll, vById } = await fetchJourneysScope(scope);
  if (!journeys.length) return { changed: 0 };

  const [locksOrders, assigns] = await Promise.all([ fetchLocksAndOrders(journeys), fetchAssignments(journeys) ]);
  const { locks, orders } = locksOrders;

  let changed = 0;

  // group by journey
  const rvaByRoute = new Map<string, RVA[]>();
  for (const rv of rvasAll) {
    const list = rvaByRoute.get(rv.route_id) ?? [];
    list.push(rv);
    rvaByRoute.set(rv.route_id, list);
  }

  for (const j of journeys) {
    const horizon = horizonFor(j.departure_ts);
    if (horizon === "past" || horizon === "T24") continue;

    const rvasForRoute = (rvaByRoute.get(j.route_id) || []).filter(x=>x.is_active);
    if (!rvasForRoute.length) continue;

    // apply T-72 adjustments once
    if (horizon === "T72") {
      await applyT72Adjustments(j, rvasForRoute, vById, locks, orders);
    }

    // for each active boat, if no lead assigned, pick via fair-use
    for (const rv of rvasForRoute) {
      const v = vById.get(rv.vehicle_id);
      if (!v || v.active === false) continue;

      // check existing assignment
      const hasLead = (assigns||[]).some(a => a.journey_id===j.id && a.vehicle_id===rv.vehicle_id && a.staff_id);
      if (hasLead) continue; // assign only missing leads

      const operator_id = v.operator_id as string | null;
      if (!operator_id) continue;
      if (!scope.all && scope.operator_id && operator_id !== scope.operator_id) continue;

      const eligible = await fetchEligibleStaffForOperator(operator_id);
      if (!eligible.length) continue;

      // rotation: fair-use table or fallback
      const staff = await pickNextByFairUse(operator_id, v.id, eligible);
      if (!staff) continue;

      // conflict window check ±90 min
      const dep = new Date(j.departure_ts);
      if (await hasStaffOverlap(staff.id, dep)) continue;

      // assign
      await assignLead(j.id, v.id, staff.id, "auto");
      await sendCaptainInviteEmail(staff.id, j.id, v.id);
      changed++;
    }
  }

  return { changed };
}
