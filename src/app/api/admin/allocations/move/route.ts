import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { allocationId, toVehicleId } = body as { allocationId: string; toVehicleId: string };

    if (!allocationId || !toVehicleId) {
      return NextResponse.json({ error: "allocationId and toVehicleId are required" }, { status: 400 });
    }

    // Update the allocation row; the BEFORE UPDATE trigger enforces validity/capacity
    const { data, error } = await sbAdmin
      .from("journey_allocations")
      .update({ vehicle_id: toVehicleId })
      .eq("id", allocationId)
      .select("*")
      .single();

    if (error) {
      // Surface trigger/constraint messages (e.g., capacity exceeded)
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ moved: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
