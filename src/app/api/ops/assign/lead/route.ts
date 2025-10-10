// src/app/api/ops/assign/lead/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Minimal server-side Supabase client (uses the caller's cookies/JWT) */
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
 * Assign (or reassign) a lead crew member to a journey+vehicle (SECURE via RPC).
 * Body: { journey_id: string, vehicle_id: string, staff_id?: string }
 * If staff_id omitted, we auto-pick the first active non-crew member
 * for the *vehicle’s operator*.
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
    let chosen: string | undefined = staff_id as string | undefined;
    if (!chosen) {
      // Find the vehicle's operator so we only pick staff from that operator
      const { data: vehRow, error: vehErr } = await sb
        .from("vehicles")
        .select("operator_id")
        .eq("id", vehicle_id)
        .maybeSingle();

      if (vehErr || !vehRow?.operator_id) {
        return NextResponse.json(
          { error: "Vehicle not found or missing operator." },
          { status: 422 }
        );
      }

      const { data: staff } = await sb
        .from("operator_staff")
        .select("id, active, jobrole")
        .eq("operator_id", vehRow.operator_id)
        .eq("active", true);

      chosen = (staff || []).find(
        (s: any) => (s.jobrole || "").toLowerCase() !== "crew"
      )?.id;

      if (!chosen) {
        return NextResponse.json(
          { error: "No eligible staff found for this operator." },
          { status: 422 }
        );
      }
    }

    // ---- SECURE ASSIGN via RPC (bypasses RLS for the insert, still checks auth/eligibility) ----
    const { data: rpcData, error: rpcErr } = await sb.rpc("ps_ops_assign_lead", {
      p_journey: journey_id,
      p_vehicle: vehicle_id,
      p_staff: chosen,
    });

    if (rpcErr) {
      // Map our hinted errors to HTTP codes
      const msg = rpcErr.message || "RPC failed";
      if (msg.startsWith("409:")) {
        return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
      }
      if (msg.startsWith("422:")) {
        return NextResponse.json({ error: "Invalid or unauthorised staff" }, { status: 422 });
      }
      if (msg.startsWith("403:")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const assignment_id: string | undefined = rpcData?.[0]?.assignment_id;

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
      assignment_id,
      view: vrows || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

