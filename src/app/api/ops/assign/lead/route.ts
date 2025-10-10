// src/app/api/ops/assign/lead/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** minimal server-side Supabase client */
function sbServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );
}

/**
 * Assign (or reassign) a lead crew member to a journey+vehicle.
 * Body: { journey_id: string, vehicle_id: string, staff_id?: string }
 * If staff_id omitted, we auto-pick first active non-crew for the operator.
 * Returns a minimal refreshed assignment row from v_crew_assignments_min.
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id } = await req.json();

    if (!journey_id || !vehicle_id) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 }
      );
    }

    const sb = sbServer();

    // If staff_id missing, pick first eligible active “lead” (non-crew)
    let chosen = staff_id as string | undefined;
    if (!chosen) {
      const { data: staff } = await sb
        .from("operator_staff")
        .select("id, active, jobrole")
        .eq("active", true);

      chosen = (staff || []).find(
        (s: any) => (s.jobrole || "").toLowerCase() !== "crew"
      )?.id;

      if (!chosen) {
        return NextResponse.json(
          { error: "No eligible staff found" },
          { status: 422 }
        );
      }
    }

    // Upsert into journey_crew_assignments as “lead”
    // NOTE: your enum values are: assigned | confirmed | declined | removed | no_show | completed
    // so we use "assigned" here.
    const payload = {
      journey_id,
      vehicle_id,
      staff_id: chosen,
      assigned_at: new Date().toISOString(),
      status: "assigned" as const, // <-- critical change
    };

    // If an active lead already exists for (journey, vehicle), treat as 409
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
      // eligibility problems bubble up as 422 when RLS/policy throws
      const msg = insErr.message || "Insert failed";
      const code = /unique|eligibl/i.test(msg) ? 422 : 500;
      return NextResponse.json({ error: msg }, { status: code });
    }

    // Return a minimal refreshed view row (includes role_label)
    const { data: vrows } = await sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
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
