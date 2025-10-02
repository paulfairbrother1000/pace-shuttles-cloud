// src/app/api/operator/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Passenger = { first_name: string | null; last_name: string | null; is_lead: boolean };

export async function GET() {
  try {
    if (!URL || !SERVICE) {
      return NextResponse.json({ ok: false, error: "Server keys not configured" }, { status: 500 });
    }
    const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

    // 1) Upcoming journeys with a vehicle
    const { data: journeys, error: jErr } = await db
      .from("journeys")
      .select(`
        id, route_id, vehicle_id, departure_ts, capacity,
        routes:route_id ( id, route_name, pickup_id, destination_id, pickup_time ),
        vehicles:vehicle_id ( id, name )
      `)
      .gte("departure_ts", new Date().toISOString())
      .order("departure_ts", { ascending: true });

    if (jErr) throw jErr;

    const journeyIds = (journeys ?? []).map((j: any) => j.id);
    if (journeyIds.length === 0) {
      return NextResponse.json({ ok: true, journeys: [], bookingsByJourney: {} });
    }

    // 2) Bookings per journey (need order_id for passengers)
    const { data: bookings, error: bErr } = await db
      .from("bookings")
      .select(`id, journey_id, route_id, order_id, seats, customer_name, status`)
      .in("journey_id", journeyIds)
      .order("created_at", { ascending: true });

    if (bErr) throw bErr;

    // 3) Passengers for all orders we have
    const orderIds = Array.from(new Set((bookings ?? []).map((b: any) => b.order_id).filter(Boolean)));
    const paxByOrder = new Map<string, Passenger[]>();

    if (orderIds.length > 0) {
      const { data: pax, error: pErr } = await db
        .from("order_passengers")
        .select("order_id, first_name, last_name, is_lead")
        .in("order_id", orderIds);

      if (pErr) throw pErr;

      for (const row of pax || []) {
        const list = paxByOrder.get(row.order_id) || [];
        list.push({
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          is_lead: !!row.is_lead,
        });
        paxByOrder.set(row.order_id, list);
      }

      for (const [k, list] of paxByOrder.entries()) {
        list.sort((a, b) => {
          if (a.is_lead !== b.is_lead) return a.is_lead ? -1 : 1;
          const an = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim().toLowerCase();
          const bn = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim().toLowerCase();
          return an.localeCompare(bn);
        });
        paxByOrder.set(k, list);
      }
    }

    // 4) Attach passengers to each booking
    const bookingsWithPax = (bookings || []).map((b: any) => ({
      ...b,
      passengers: paxByOrder.get(b.order_id) || [],
    }));

    // 5) Group by journey for UI
    const bookingsByJourney: Record<string, any[]> = {};
    for (const b of bookingsWithPax) {
      (bookingsByJourney[b.journey_id] ||= []).push(b);
    }

    return NextResponse.json({ ok: true, journeys, bookingsByJourney });
  } catch (e: any) {
    console.error("[/api/operator] error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

export {};
