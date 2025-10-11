// src/app/api/ops/assign/lead/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type UUID = string;

/** Server-side Supabase using caller's session (RLS respected) */
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
        // set/remove are optional in route handlers, but harmless:
        set() {},
        remove() {},
      },
    }
  );
}

/**
 * Assign (or reassign) a lead (CAPTAIN) to a journey+vehicle.
 * Body: { journey_id: UUID, vehicle_id: UUID, staff_id?: UUID }
 * If staff_id is omitted, we pick the first eligible active non-crew staff
 * for the vehicle’s operator.
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id } = (await req.json()) as {
      journey_id?: UUID;
      vehicle_id?: UUID;
      staff_id?: UUID;
    };

    if (!journey_id || !vehicle_id) {
      return NextResponse.json({ error: "Missing journey_id or vehicle_id" }, { status: 400 });
    }

    const sb = sbServer();

    // Resolve staff if not provided: restrict to the vehicle's operator, active, and not "crew"
    let chosen: UUID | undefined = staff_id;
    if (!chosen) {
      const { data: vehRow, error: vehErr } = await sb
        .from("vehicles")
        .select("operator_id")
        .eq("id", vehicle_id)
        .maybeSingle();

      if (vehErr || !vehRow?.operator_id) {
        return NextResponse.json(
          { error: "Vehicle not found or missing operator_id" },
          { status: 422 }
        );
      }

      const { data: staffRows, error: stErr } = await sb
        .from("operator_staff")
        .select("id, active, jobrole")
        .eq("operator_id", vehRow.operator_id)
        .eq("active", true);

      if (stErr) {
        return NextResponse.json({ error: stErr.message || "Staff lookup failed" }, { status: 500 });
      }

      chosen = (staffRows || []).find(
        (s: any) => (s.jobrole || "").toLowerCase() !== "crew"
      )?.id as UUID | undefined;

      if (!chosen) {
        return NextResponse.json(
          { error: "No eligible staff found for this operator" },
          { status: 422 }
        );
      }
    }

    // Secure write via RPC: api_upsert_crew_assignment(journey, vehicle, staff, 'CAPTAIN')
    const { data: rpcData, error: rpcErr, status: rpcStatus } = await sb.rpc(
      "api_upsert_crew_assignment",
      {
        p_journey_id: journey_id,
        p_vehicle_id: vehicle_id,
        p_staff_id: chosen,
        p_role_code: "CAPTAIN",
      }
    );

    if (rpcErr) {
      // Normalise common DB errors into HTTP responses
      const msg = rpcErr.message || "RPC failed";
      const code = (rpcErr as any).code as string | undefined;

      // Unique violation: captain already assigned on this journey+vehicle
      if (code === "23505" || /jca_one_captain_per_jv/i.test(msg) || /Only one lead/i.test(msg)) {
        return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
      }

      // Auth/permission style errors surfaced from the function
      if (/unauthorised|forbidden|permission/i.test(msg)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Validation style errors
      if (/invalid|not found|eligible|operator/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 422 });
      }

      // Fallback
      return NextResponse.json({ error: msg }, { status: rpcStatus || 500 });
    }

    // Try to extract the assignment_id if the function returns it
    const assignment_id: string | undefined =
      (Array.isArray(rpcData) ? rpcData?.[0]?.assignment_id : (rpcData as any)?.assignment_id) ??
      undefined;

    // Return a minimal refreshed view row so UI updates cleanly
    const { data: vrows, error: vErr } = await sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id);

    if (vErr) {
      // Non-fatal; still return ok=true with rpc result
      return NextResponse.json({
        ok: true,
        assignment_id,
        view: [],
        note: "Assigned, but failed to refresh view",
      });
    }

    return NextResponse.json({
      ok: true,
      assignment_id,
      view: vrows || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
