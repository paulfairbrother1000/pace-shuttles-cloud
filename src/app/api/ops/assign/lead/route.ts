// src/app/api/ops/assign/lead/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sbServer, resolveStaffIfNeeded, refreshCrewView, rpcAssign, UUID, mapRpcError } from "../_util";


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
 * If staff_id is missing, try to pick a suitable staff member for the vehicle's operator.
 * Criteria: operator match, active=true, jobrole != 'crew' (case-insensitive), first match.
 */
async function resolveStaffIfNeeded(
  sb: ReturnType<typeof sbServer>,
  vehicle_id?: UUID | null,
  staff_id?: UUID | null
): Promise<UUID> {
  if (staff_id) return staff_id;
  if (!vehicle_id) {
    throw new Error("staff_id is missing and vehicle_id not provided to resolve staff");
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
      staff_id = null,
      vehicle_id = null,
      role_id = null,
    } = (await req.json()) as {
      journey_id?: UUID;
      staff_id?: UUID | null;
      vehicle_id?: UUID | null;
      role_id?: UUID | null;
    };

    if (!journey_id) {
      return NextResponse.json({ error: "journey_id is required" }, { status: 400 });
    }

    const sb = sbServer();

    // Resolve staff if not provided
    let chosenStaff: UUID;
    try {
      chosenStaff = await resolveStaffIfNeeded(sb, vehicle_id, staff_id);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Unable to resolve staff" }, { status: 422 });
    }

    // Call DB RPC to assign (inserts a row with status_simple default 'allocated')
    const { data: assignment, error: rpcErr, status } = await sb.rpc("ops_assign_lead", {
      p_journey_id: journey_id,
      p_staff_id: chosenStaff,
      p_vehicle_id: vehicle_id,
      p_role_id: role_id, // may be null if you don't use role_ids
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

    // Optional: try to refresh a compact view for the UI; ignore errors
    let view: any[] = [];
    try {
      const { data: vrows, error: vErr } = await sb
        .from("v_crew_assignments_min")
        .select(
          "assignment_id, journey_id, vehicle_id, staff_id, role_label, first_name, last_name, status_simple, is_lead"
        )
        .eq("journey_id", journey_id);

      if (!vErr && Array.isArray(vrows)) view = vrows;
    } catch {
      // view not present; ignore
    }

    return NextResponse.json({
      ok: true,
      assignment, // full journey_assignments row from RPC
      view,       // optional UI convenience
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
