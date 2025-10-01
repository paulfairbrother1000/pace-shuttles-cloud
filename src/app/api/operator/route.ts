// src/app/api/operator/route.ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role

export async function GET() {
  const db = createClient(url, key, { auth: { persistSession: false } });

  // 1) journeys with vehicle etc — (whatever you had before)
  const { data: journeys, error: jErr } = await db
    .from("journeys_with_vehicle") // or your existing source
    .select("*")
    .order("departure_ts", { ascending: true });

  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 });

  // 2) bookings + passengers from the VIEW
  const { data: rows, error: bErr } = await db
    .from("operator_bookings_with_pax")
    .select("booking_id, journey_id, vehicle_name, seats, pax");

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  // group bookings by journey_id and attach to journeys
  const byJourney = new Map<string, any[]>();
  for (const r of rows || []) {
    const list = byJourney.get(r.journey_id) ?? [];
    list.push({
      id: r.booking_id,
      vehicle_name: r.vehicle_name,
      seats: r.seats,
      passengers: r.pax ?? [], // <-- expose passengers to UI
    });
    byJourney.set(r.journey_id, list);
  }

  const out = (journeys || []).map((j: any) => ({
    ...j,
    bookings: byJourney.get(j.id) ?? [],
  }));

  return NextResponse.json({ journeys: out });
}
