// src/app/api/ops/crew/list/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// expose this route at build time even without static paths
export const dynamic = "force-dynamic";

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
        set() {},
        remove() {},
      },
    }
  );
}

/**
 * GET /api/ops/crew/list?journey_id=<uuid>[&vehicle_id=<uuid>]
 * Returns rows from v_crew_assignments_min for the given scope.
 * Expected columns (view): assignment_id, journey_id, vehicle_id, staff_id,
 * status_simple, first_name, last_name, role_label
 */
export async function GET(req: Request) {
  try {
    const sb = sbServer();
    const url = new URL(req.url);
    const journey_id = url.searchParams.get("journey_id");
    const vehicle_id = url.searchParams.get("vehicle_id");

    if (!journey_id) {
      return NextResponse.json({ error: "journey_id is required" }, { status: 400 });
    }

    let q = sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id);

    if (vehicle_id) q = q.eq("vehicle_id", vehicle_id);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, data: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
