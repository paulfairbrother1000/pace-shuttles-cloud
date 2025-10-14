// src/app/api/ops/crew/list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Force dynamic so Next doesn’t try to prerender this route
export const dynamic = "force-dynamic";

/**
 * This route is called by the Operator dashboard to display the
 * assigned captain/crew per journey/vehicle.
 *
 * Query params:
 *   ?journey_id=<uuid>[&vehicle_id=<uuid>]
 *
 * Reads from view: v_crew_assignments_min
 * Expected columns in the view:
 *   assignment_id, journey_id, vehicle_id, staff_id,
 *   status_simple, first_name, last_name, role_label
 */

// Use SERVICE ROLE on server to bypass RLS for admin views
function sbAdmin() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient(url, key);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const journey_id = url.searchParams.get("journey_id");
    const vehicle_id = url.searchParams.get("vehicle_id");

    if (!journey_id) {
      return NextResponse.json(
        { error: "journey_id is required" },
        { status: 400 }
      );
    }

    const sb = sbAdmin();

    let q = sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id);

    if (vehicle_id) q = q.eq("vehicle_id", vehicle_id);

    const { data, error } = await q;

    if (error) {
      // Surface the actual DB error for quick diagnosis in the console
      return NextResponse.json(
        { error: error.message || "Select failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data: data || [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
