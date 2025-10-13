// src/app/api/ops/assign/lead/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type UUID = string;

function sbServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (k: string) => cookieStore.get(k)?.value,
        set() {},
        remove() {},
      },
    }
  );
}

/**
 * Try to resolve operator_staff.id from different hints:
 *  1) explicit staff_id
 *  2) staff_user_id (+ optional vehicle_id to scope to that operator)
 *  3) fall back to a suitable active non-"crew" staff member by vehicle operator
 */
async function resolveStaffId(
  sb: ReturnType<typeof sbServer>,
  opts: {
    staff_id?: UUID | null;
    staff_user_id?: UUID | null;
    vehicle_id?: UUID | null;
  }
): Promise<UUID> {
  const { staff_id, staff_user_id, vehicle_id } = opts;

  if (staff_id) return staff_id;

  // If we have a staff_user_id, try to map to operator_staff.id
  if (staff_user_id) {
    // Optionally scope to the operator that owns the vehicle
    let operatorId: UUID | null = null;
    if (vehicle_id) {
      const { data: veh } = await sb
        .from("vehicles")
        .select("operator_id")
        .eq("id", vehicle_id)
        .maybeSingle();
      operatorId = (veh as any)?.operator_id ?? null;
    }

    const q = sb
      .from("operator_staff")
      .select("id, active")
      .eq("user_id", staff_user_id)
      .eq("active", true);

    const { data: staffRows, error } = operatorId ? await q.eq("operator_id", operatorId) : await q;
    if (error) throw new Error(error.message || "Failed to look up staff_user_id");

    const found = (staffRows ?? [])[0]?.id as UUID | undefined;
    if (found) return found;
  }

  // Fallback: pick the first eligible active non-"crew" for the vehicle's operator
  if (!vehicle_id) {
    throw new Error("Unable to resolve staff: supply staff_id or staff_user_id or vehicle_id");
  }

  const { data: vehicle, error: vehErr } = await sb
    .from("vehicles")
    .select("operator_id")
    .eq("id", vehicle_id)
    .maybeSingle();

  if (vehErr) throw new Error(vehErr.message || "Vehicle lookup failed");
  if (!vehicle?.operator_id) throw new Error("Vehicle has no operator_id");

  const { data: staffRows, error: stErr } = await sb
    .from("operator_staff")
    .select("id, active, jobrole")
    .eq("operator_id", vehicle.operator_id)
    .eq("active", true);

  if (stErr) throw new Error(stErr.message || "Staff lookup failed");

  const chosen = (staffRows ?? []).find(
    (s: any) => String(s?.jobrole ?? "").toLowerCase() !== "crew"
  )?.id as UUID | undefined;

  if (!chosen) throw new Error("No eligible staff found for this operator");
  return chosen;
}

export async function POST(req: Request) {
  try {
    const {
      journey_id,
      vehicle_id = null,
      role_id = null,
      staff_id = null,
      staff_user_id = null, // NEW: accept user id too
    } = (await req.json()) as {
      journey_id?: UUID;
      vehicle_id?: UUID | null;
      role_id?: UUID | null;
      staff_id?: UUID | null;
      staff_user_id?: UUID | null;
    };

    if (!journey_id) {
      return NextResponse.json({ error: "journey_id is required" }, { status: 400 });
    }

    const sb = sbServer();

    let chosenStaff: UUID;
    try {
      chosenStaff = await resolveStaffId(sb, { staff_id, staff_user_id, vehicle_id });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Unable to resolve staff" }, { status: 422 });
    }

    // Assign via RPC (expects operator_staff.id)
    const { data: assignment, error: rpcErr, status } = await sb.rpc("ops_assign_lead", {
      p_journey_id: journey_id,
      p_staff_id: chosenStaff,
      p_vehicle_id: vehicle_id,
      p_role_id: role_id,
    });

    if (rpcErr) {
      const msg = rpcErr.message || "RPC failed";
      if (/permission|rls|forbidden|unauthor/i.test(msg)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (/unique|duplicate|already|only one/i.test(msg)) {
        return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
      }
      return NextResponse.json({ error: msg }, { status: status || 400 });
    }

    // Return the fresh mini-view for this journey/vehicle
    let view: any[] = [];
    try {
      const sel = sb
        .from("v_crew_assignments_min")
        .select(
          "assignment_id, journey_id, vehicle_id, staff_id, role_label, first_name, last_name, status_simple, assign_source, is_lead"
        )
        .eq("journey_id", journey_id);

      const finalSel = vehicle_id ? sel.eq("vehicle_id", vehicle_id) : sel;
      const { data: vrows } = await finalSel;
      if (Array.isArray(vrows)) view = vrows;
    } catch {
      // ignore if view missing
    }

    return NextResponse.json({ ok: true, assignment, view });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
