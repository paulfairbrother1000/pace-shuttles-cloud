// src/app/api/ops/crew/list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

type RowPreferred = {
  assignment_id: string;
  journey_id: string;
  vehicle_id: string | null;
  staff_id: string | null;
  status_simple: string | null;
  first_name: string | null;
  last_name: string | null;
  role_label: string | null;
};

type RowFallback = {
  id: string;
  journey_id: string;
  vehicle_id: string | null;
  staff_id: string | null;
  status_simple: string | null;
  first_name: string | null;
  last_name: string | null;
  role_label: string | null;
};

export async function GET(req: Request) {
  const startedAt = Date.now();
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

    // ---- Attempt 1: preferred schema (assignment_id exists) ----
    let dataPreferred: RowPreferred[] | null = null;
    let errPreferred: string | null = null;
    try {
      let q1 = sb
        .from("v_crew_assignments_min")
        .select(
          "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
        )
        .eq("journey_id", journey_id);

      if (vehicle_id) q1 = q1.eq("vehicle_id", vehicle_id);

      const { data, error } = await q1;
      if (error) throw error;
      dataPreferred = (data ?? []) as RowPreferred[];
    } catch (e: any) {
      errPreferred = e?.message ?? String(e);
    }

    if (dataPreferred) {
      // success path
      return NextResponse.json(
        {
          ok: true,
          data: dataPreferred,
          meta: { schema: "preferred", ms: Date.now() - startedAt },
        },
        { status: 200 }
      );
    }

    // ---- Attempt 2: fallback schema (column is named id) ----
    let dataFallback: RowFallback[] | null = null;
    try {
      let q2 = sb
        .from("v_crew_assignments_min")
        .select(
          "id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
        )
        .eq("journey_id", journey_id);

      if (vehicle_id) q2 = q2.eq("vehicle_id", vehicle_id);

      const { data, error } = await q2;
      if (error) throw error;
      dataFallback = (data ?? []) as RowFallback[];
    } catch (e: any) {
      // Both attempts failed — return the more helpful message.
      const msg = e?.message ?? String(e);
      console.error(
        "[crew/list] both schema attempts failed",
        { errPreferred, errFallback: msg, journey_id, vehicle_id }
      );
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      );
    }

    // Map fallback schema to the shape the UI expects.
    const mapped: RowPreferred[] = (dataFallback ?? []).map((r) => ({
      assignment_id: r.id,
      journey_id: r.journey_id,
      vehicle_id: r.vehicle_id,
      staff_id: r.staff_id,
      status_simple: r.status_simple,
      first_name: r.first_name,
      last_name: r.last_name,
      role_label: r.role_label,
    }));

    console.warn(
      "[crew/list] using fallback schema (no assignment_id column on view)",
      { journey_id, vehicle_id }
    );

    return NextResponse.json(
      {
        ok: true,
        data: mapped,
        meta: { schema: "fallback", ms: Date.now() - startedAt },
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[crew/list] fatal", e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
