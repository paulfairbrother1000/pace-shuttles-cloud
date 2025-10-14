// src/app/api/ops/assign/lead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { journeyId, staffId } = await req.json();
    if (!journeyId || !staffId) return NextResponse.json({ error: "journeyId & staffId required" }, { status: 400 });

    const { data: j } = await sb.from("journeys").select("id, vehicle_id, operator_id, departure_ts").eq("id", journeyId).single();
    if (!j?.vehicle_id || !j?.operator_id) throw new Error("Journey missing vehicle/operator");

    // T-window: allow manual override at any time (your rule), but keep log
    // Remove existing lead
    await sb.from("journey_crew_assignments").delete().eq("journey_id", journeyId).eq("role_code", "CAPTAIN");

    // Assign new
    const { error: insErr } = await sb.from("journey_crew_assignments").insert({
      journey_id: journeyId,
      vehicle_id: j.vehicle_id,
      staff_id: staffId,
      role_code: "CAPTAIN",
      status: "assigned",
    });
    if (insErr) throw insErr;

    // ledger
    await sb.from("captain_fairuse_ledger").insert({
      operator_id: j.operator_id,
      vehicle_id: j.vehicle_id,
      journey_id: journeyId,
      staff_id: staffId,
      confirmed: false,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
