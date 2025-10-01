// src/app/api/operator/remove-boat/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type UUID = string;

type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
type Order   = { id: UUID; status: string; route_id: UUID | null; journey_date: string | null; qty: number | null };
type RVA     = { route_id: UUID; vehicle_id: UUID; is_active: boolean; preferred: boolean };
type Vehicle = { id: UUID; active: boolean | null; maxseats: number | string | null; operator_id: UUID | null };

type Party = { order_id: UUID; size: number };
type Boat  = { vehicle_id: UUID; cap: number; preferred: boolean };

function toDateISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Same allocation logic you use in the client: keep groups whole, prefer “preferred” boats, pack tightly. */
function allocateDetailed(parties: Party[], boats: Boat[]) {
  const sorted = [...parties].filter(p => p.size > 0).sort((a, b) => b.size - a.size);
  const state = boats.map(b => ({
    id: b.vehicle_id,
    cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
    used: 0,
    preferred: !!b.preferred,
  }));

  const byBoat = new Map<UUID, { seats: number; orders: { order_id: UUID; size: number }[] }>();
  const unassigned: { order_id: UUID; size: number }[] = [];

  for (const g of sorted) {
    const candidates = state
      .map(s => ({ id: s.id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter(c => c.free >= g.size)
      .sort((a, b) => {
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        if (a.free !== b.free) return a.free - b.free;
        return a.id.localeCompare(b.id);
      });

    if (!candidates.length) {
      unassigned.push({ order_id: g.order_id, size: g.size });
      continue;
    }

    const chosen = candidates[0];
    chosen.ref.used += g.size;

    const cur = byBoat.get(chosen.id) ?? { seats: 0, orders: [] as { order_id: UUID; size: number }[] };
    cur.seats += g.size;
    cur.orders.push({ order_id: g.order_id, size: g.size });
    byBoat.set(chosen.id, cur);
  }

  const total = sorted.reduce((s, p) => s + p.size, 0);
  return { byBoat, unassigned, total };
}

export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id } = (await req.json()) as {
      journey_id?: string;
      vehicle_id?: string;
    };

    if (!journey_id || !vehicle_id) {
      return NextResponse.json({ error: "journey_id and vehicle_id are required" }, { status: 400 });
    }

    // --- Supabase (server) with proper cookie wiring ---
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => cookieStore.get(name)?.value,
          set: (name: string, value: string, options: any) => cookieStore.set({ name, value, ...options }),
          remove: (name: string, options: any) => cookieStore.set({ name, value: "", ...options, maxAge: 0 }),
        },
      }
    );

    // 1) Journey (to get route_id and the exact departure date)
    const { data: j, error: jErr } = await supabase
      .from("journeys")
      .select("id,route_id,departure_ts,is_active")
      .eq("id", journey_id)
      .maybeSingle<Journey>();
    if (jErr || !j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

    const journeyDate = toDateISO(new Date(j.departure_ts));

    // 2) All PAID orders for this route & date (these are the groups to maintain)
    const { data: orders, error: oErr } = await supabase
      .from("orders")
      .select("id,status,route_id,journey_date,qty")
      .eq("status", "paid")
      .eq("route_id", j.route_id)
      .eq("journey_date", journeyDate) as unknown as { data: Order[]; error: any };
    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

    const parties: Party[] =
      (orders || [])
        .map(o => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
        .filter(p => p.size > 0);

    // 3) Candidate boats for this journey = active RVAs + active vehicles, EXCLUDING the removed vehicle
    const { data: rvas, error: rErr } = await supabase
      .from("route_vehicle_assignments")
      .select("route_id,vehicle_id,is_active,preferred")
      .eq("route_id", j.route_id)
      .eq("is_active", true) as unknown as { data: RVA[]; error: any };
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

    const vehIds = (rvas || []).map(r => r.vehicle_id);
    const { data: vehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id,active,maxseats,operator_id")
      .in("id", vehIds) as unknown as { data: Vehicle[]; error: any };
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

    const vehById = new Map(vehicles.map(v => [v.id, v]));
    const boats: Boat[] = (rvas || [])
      .filter(r => r.is_active && r.vehicle_id !== vehicle_id)
      .map(r => {
        const v = vehById.get(r.vehicle_id);
        const cap = Number(v?.maxseats ?? 0);
        return v && v.active !== false
          ? { vehicle_id: r.vehicle_id, cap: Number.isFinite(cap) ? cap : 0, preferred: !!r.preferred }
          : null;
      })
      .filter(Boolean) as Boat[];

    if (!boats.length) {
      return NextResponse.json({ error: "No remaining boats to allocate to." }, { status: 409 });
    }

    // 4) Allocate all groups to the remaining boats
    const alloc = allocateDetailed(parties, boats);
    if (alloc.unassigned.length) {
      // We require full reassignment (your policy), so fail and do nothing
      return NextResponse.json(
        { error: "Reallocation failed: not enough capacity on remaining boats.", unassigned: alloc.unassigned },
        { status: 409 }
      );
    }

    // 5) Persist: replace the journey’s lock with our computed lock
    //    (simple & robust: delete all rows for this journey, then insert the new complete set)
    const { error: delErr } = await supabase
      .from("journey_vehicle_allocations")
      .delete()
      .eq("journey_id", journey_id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    const lockRows = [] as { journey_id: UUID; vehicle_id: UUID; order_id: UUID; seats: number }[];
    for (const [veh, info] of alloc.byBoat.entries()) {
      for (const o of info.orders) {
        lockRows.push({
          journey_id,
          vehicle_id: veh,
          order_id: o.order_id,
          seats: o.size,
        });
      }
    }

    if (lockRows.length) {
      const { error: insErr } = await supabase
        .from("journey_vehicle_allocations")
        .insert(lockRows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, lock: lockRows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
