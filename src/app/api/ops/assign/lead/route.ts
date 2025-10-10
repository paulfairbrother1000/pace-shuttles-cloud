// Server-only
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function serverSB() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (k: string) => cookies().get(k)?.value } }
  );
}

/**
 * Assign a *lead* crew member to (journey, vehicle).
 * Body: { journey_id, vehicle_id, staff_id? } – if staff_id omitted, server will auto-pick.
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id } = await req.json();
    if (!journey_id || !vehicle_id) {
      return NextResponse.json({ error: "Missing journey_id or vehicle_id" }, { status: 400 });
    }

    const sb = serverSB();

    // If staff_id missing, pick first eligible active “lead” for this operator (simple heuristic).
    let chosen = staff_id as string | undefined;
    if (!chosen) {
      const { data: staff } = await sb
        .from("operator_staff")
        .select("id, active, jobrole")
        .eq("active", true);
      chosen = (staff || []).find(s => (s.jobrole || "").toLowerCase() !== "crew")?.id;
      if (!chosen) {
        return NextResponse.json({ error: "No eligible staff found" }, { status: 422 });
      }
    }

    // Upsert into journey_crew_assignments as "lead" (is_lead=true is modeled by non-Crew role).
    // We do not read role_label from the table; we just create/confirm the row minimally.
    const payload = {
      journey_id,
      vehicle_id,
      staff_id: chosen,
      assigned_at: new Date().toISOString(),
      status: "allocated" as any, // your enum; will move to confirmed by flow/T-24
    };

    // If an active lead already exists for (journey, vehicle), treat as 409.
    const { data: existing } = await sb
      .from("journey_crew_assignments")
      .select("id, journey_id, vehicle_id, staff_id, status")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .limit(1);

    if (existing && existing.length) {
      return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
    }

    const { data: inserted, error: insErr } = await sb
      .from("journey_crew_assignments")
      .insert(payload)
      .select("id")
      .single();

    if (insErr) {
      // Unique or eligibility problems should surface as 422, everything else 500
      const msg = insErr.message || "Insert failed";
      const code = /unique|eligib|confl/i.test(msg) ? 422 : 500;
      return NextResponse.json({ error: msg }, { status: code });
    }

    // Return the minimal refreshed view row (NOTE: the view contains role_label; table does not)
    const { data: vrows } = await sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id);

    return NextResponse.json({
      ok: true,
      assignment_id: inserted?.id,
      view: vrows || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
