import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseServer"; // your small wrapper to create service-role SB
import { sql } from "@/lib/sql"; // thin helper if you have one, otherwise inline SB queries

// Scans journeys >24h and <=72h out, with bookings and no lead yet.
// Marks auto_assign_attempted_at to avoid rework thrash.
// Enqueues work by calling the same /ops/assign/lead API your UI uses (server-side fetch).

export async function GET() {
  const sb = createClient();

  // 1) Find candidate journeys
  const { data: rows, error } = await sb.rpc("ps_find_autoassign_candidates", {}); 
  // If you don’t want an RPC, replace with a select + where chain.

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ ok: true, scanned: 0 });

  // 2) For each journey+vehicle, attempt assign (server fetch to internal API)
  let ok = 0, fail = 0;
  for (const r of rows as Array<{ journey_id: string; vehicle_id: string }>) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ops/assign/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ journey_id: r.journey_id, vehicle_id: r.vehicle_id }),
      });
      ok++;
    } catch {
      fail++;
    }
  }

  return NextResponse.json({ ok: true, scanned: rows.length, assigned: ok, failed: fail });
}
