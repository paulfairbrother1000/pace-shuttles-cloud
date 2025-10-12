// src/app/api/ops/assign/crew/route.ts
import { NextResponse } from "next/server";
import { sbServer, resolveStaffIfNeeded, refreshCrewView, rpcAssign, UUID } from "../_util";

export async function POST(req: Request) {
  try {
    const { journey_id, staff_id = null, vehicle_id = null, role_id = null } =
      (await req.json()) as {
        journey_id?: UUID;
        staff_id?: UUID | null;
        vehicle_id?: UUID | null;
        role_id?: UUID | null; // pass a specific crew role_id if you enforce per-role uniqueness
      };

    if (!journey_id) {
      return NextResponse.json({ error: "journey_id is required" }, { status: 400 });
    }

    const sb = sbServer();
    const chosenStaff = await resolveStaffIfNeeded(sb, vehicle_id, staff_id);

    const { data, error, status } = await rpcAssign(sb, "ops_assign_crew", {
      p_journey_id: journey_id,
      p_staff_id: chosenStaff,
      p_vehicle_id: vehicle_id,
      p_role_id: role_id,
    });
    if (error) {
      const mapped = (await import("../_util")).mapRpcError(error);
      return NextResponse.json(mapped.body, { status: mapped.code || status || 400 });
    }

    const view = await refreshCrewView(sb, journey_id);
    return NextResponse.json({ ok: true, assignment: data, view });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
