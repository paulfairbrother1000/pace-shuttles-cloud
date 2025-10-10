import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * POST /api/operator/remove-boat
 * Body: { journey_id: uuid, vehicle_id: uuid }
 *
 * Removes all allocations for the given (journey, vehicle), then attempts
 * to reassign those groups onto other active vehicles assigned to the route/journey.
 * If all groups can be reallocated within capacity, it persists and returns the new lock set.
 * If not, it returns 409 and does not mutate data.
 */

function sbFromCookies() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => jar.get(n)?.value,
        set: (n: string, v: string, o: any) => { try { jar.set({ name: n, value: v, ...o }); } catch {} },
        remove: (n: string, o: any) => { try { jar.set({ name: n, value: "", ...o }); } catch {} },
      },
    }
  );
}

type LockRow = { journey_id: string; vehicle_id: string; order_id: string; seats: number };

export async function POST(req: NextRequest) {
  const sb = sbFromCookies();

  const body = await req.json().catch(() => ({}));
  const journey_id = (body?.journey_id || "").trim();
  const vehicle_id = (body?.vehicle_id || "").trim();

  if (!journey_id || !vehicle_id) {
    return NextResponse.json({ error: "journey_id and vehicle_id are required" }, { status: 400 });
  }

  // Load the journey and its route/operator
  const { data: j, error: jErr } = await sb
    .from("journeys")
    .select("id, route_id, operator_id, departure_ts, is_active")
    .eq("id", journey_id)
    .maybeSingle();
  if (jErr || !j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  // All current locks for this journey
  const { data: allLocks, error: lErr } = await sb
    .from("journey_vehicle_allocations")
    .select("journey_id, vehicle_id, order_id, seats")
    .eq("journey_id", journey_id);

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  // Groups to re-seat (all groups currently on the vehicle being removed)
  const groupsToReassign: LockRow[] = (allLocks || []).filter(r => r.vehicle_id === vehicle_id);

  // If no groups on this boat, we can simply delete its (empty) records and return the current state
  // (deleting in case there are any stray rows)
  // But still ensure reassignment can proceed (it's empty so trivial).
  // Next: build the candidate boats we can move onto.

  // Candidate (other) boats for this journey: from route_vehicle_assignments + vehicles.active
  // NOTE: if you also have a direct journey->vehicle relation, extend this accordingly.
  const { data: rvas } = await sb
    .from("route_vehicle_assignments")
    .select("route_id, vehicle_id, is_active, preferred")
    .eq("route_id", j.route_id)
    .eq("is_active", true);

  const candidateIds = new Set<string>((rvas || []).map(r => r.vehicle_id).filter(id => id !== vehicle_id));

  // Load capacities and ownership for those vehicles
  const { data: vehicles } = await sb
    .from("vehicles")
    .select("id, operator_id, active, maxseats")
    .in("id", Array.from(candidateIds));

  const candidates = (vehicles || [])
    .filter(v => v.active === true && v.operator_id === j.operator_id)
    .map(v => ({ id: v.id as string, cap: Math.max(0, Number(v.maxseats || 0)) }));

  // Current usage per candidate (already-locked groups on them)
  const usage = new Map<string, number>();
  (allLocks || []).forEach(r => {
    if (r.vehicle_id === vehicle_id) return; // ignore the boat we’re removing
    const prev = usage.get(r.vehicle_id) || 0;
    usage.set(r.vehicle_id, prev + Number(r.seats || 0));
  });

  // Greedy reallocation: largest group first; place on boat with smallest free but sufficient
  const groups = groupsToReassign
    .map(g => ({ order_id: g.order_id, size: Number(g.seats || 0) }))
    .filter(g => g.size > 0)
    .sort((a, b) => b.size - a.size);

  // If there are no groups, we just delete any rows for the removed boat and return.
  if (groups.length === 0) {
    await sb
      .from("journey_vehicle_allocations")
      .delete()
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id);

    // Return current locks (minus removed boat rows)
    const remaining = (allLocks || []).filter(r => r.vehicle_id !== vehicle_id);
    return NextResponse.json({ lock: remaining });
  }

  // Build free capacity for each candidate
  const state = candidates.map(c => ({
    id: c.id,
    free: Math.max(0, c.cap - (usage.get(c.id) || 0)),
  }));

  // Make a mutable plan of { vehicle_id -> group sizes[] }
  const plan = new Map<string, Array<{ order_id: string; size: number }>>();

  for (const g of groups) {
    // find sufficient boats sorted by (free asc, id)
    const options = state
      .filter(s => s.free >= g.size)
      .sort((a, b) => (a.free !== b.free ? a.free - b.free : a.id.localeCompare(b.id)));
    if (!options.length) {
      return NextResponse.json(
        { error: "No capacity on other boats to reassign all groups" },
        { status: 409 }
      );
    }
    const chosen = options[0];
    chosen.free -= g.size;
    const arr = plan.get(chosen.id) || [];
    arr.push({ order_id: g.order_id, size: g.size });
    plan.set(chosen.id, arr);
  }

  // All groups can be reallocated. Apply changes in a small transactionish sequence.
  // 1) Delete old rows for the removed boat.
  const { error: delErr } = await sb
    .from("journey_vehicle_allocations")
    .delete()
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // 2) Insert the new rows for each target boat.
  const inserts: LockRow[] = [];
  for (const [vehId, list] of plan.entries()) {
    for (const g of list) {
      inserts.push({
        journey_id,
        vehicle_id: vehId,
        order_id: g.order_id,
        seats: g.size,
      });
    }
  }

  if (inserts.length) {
    const { error: insErr } = await sb
      .from("journey_vehicle_allocations")
      .upsert(inserts, { onConflict: "journey_id,vehicle_id,order_id" });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // 3) Return the new full lock set for this journey (fresh read)
  const { data: freshLocks, error: freshErr } = await sb
    .from("journey_vehicle_allocations")
    .select("journey_id, vehicle_id, order_id, seats")
    .eq("journey_id", journey_id);

  if (freshErr) return NextResponse.json({ error: freshErr.message }, { status: 500 });

  // Optional: a short “route” message for the UI
  const summary = Array.from(plan.entries())
    .map(([veh, list]) => `${list.reduce((s, x) => s + x.size, 0)} seats → ${veh.slice(0, 8)}`)
    .join(" • ");

  return NextResponse.json({
    lock: freshLocks || [],
    route: summary ? `Reassigned: ${summary}` : undefined,
  });
}
