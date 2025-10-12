// src/app/api/operator/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/operator
 * Creates an operator_staff row (service key bypasses RLS).
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();

    const payload = {
      operator_id: b.operator_id,
      type_id: b.type_id ?? null,
      type_ids: b.type_ids ?? null,
      jobrole: b.jobrole ?? null,
      pronoun: b.pronoun ?? "they",
      first_name: b.first_name,
      last_name: b.last_name,
      email: b.email ?? null,
      status: b.status ?? "Active",
      licenses: b.licenses ?? null,
      notes: b.notes ?? null,
      photo_url: b.photo_url ?? null,
    };

    const db = supabaseService();
    const { data, error } = await db
      .from("operator_staff")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ id: data!.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad Request" }, { status: 400 });
  }
}

/**
 * GET /api/operator
 * Example payload that joins journeys with bookings and passengers.
 * Adjust table/view names if yours differ.
 */
export async function GET(_req: NextRequest) {
  const db = supabaseService();

  // 1) Journeys (replace source name if different in your schema)
  const { data: journeys, error: jErr } = await db
    .from("journeys_with_vehicle")
    .select("*")
    .order("departure_ts", { ascending: true });

  if (jErr) {
    return NextResponse.json({ error: jErr.message }, { status: 500 });
  }

  // 2) Bookings + passengers (replace view name if different)
  const { data: rows, error: bErr } = await db
    .from("operator_bookings_with_pax")
    .select("booking_id, journey_id, vehicle_name, seats, pax");

  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 });
  }

  // Group bookings by journey_id and attach to journeys list
  const byJourney = new Map<string, any[]>();
  for (const r of rows || []) {
    const list = byJourney.get(r.journey_id) ?? [];
    list.push({
      id: r.booking_id,
      vehicle_name: r.vehicle_name,
      seats: r.seats,
      passengers: r.pax ?? [],
    });
    byJourney.set(r.journey_id, list);
  }

  const out = (journeys || []).map((j: any) => ({
    ...j,
    bookings: byJourney.get(j.id) ?? [],
  }));

  return NextResponse.json({ journeys: out });
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
