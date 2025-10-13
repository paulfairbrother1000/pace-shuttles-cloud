// src/app/api/ops/assign/lead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function horizonFor(tsISO: string): "T24"|"T72"|">72h"|"past" {
  const now = new Date(); const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime()-now.getTime())/36e5;
  if (h <= 24) return "T24"; if (h <= 72) return "T72"; return ">72h";
}

export async function POST(req: NextRequest) {
  try {
    const { journey_id, vehicle_id, staff_id } = await req.json();

    // T-24 lock enforcement
    const { data: j } = await sb.from("journeys").select("id,departure_ts").eq("id", journey_id).maybeSingle();
    if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });
    const horizon = horizonFor(j.departure_ts);
    if (horizon === "T24" || horizon === "past") {
      return NextResponse.json({ error: "Crew changes are locked at T-24." }, { status: 409 });
    }

    // assign via RPC (mark as manual)
    const { error } = await sb.rpc("assign_lead", { p_journey_id: journey_id, p_vehicle_id: vehicle_id, p_staff_id: staff_id, p_mode: "manual" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // notify
    try { await fetch(process.env.MAILER_WEBHOOK_URL || "", { method: "POST", body: JSON.stringify({ staff_id, journey_id, vehicle_id }) }); } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Assign failed" }, { status: 500 });
  }
}
