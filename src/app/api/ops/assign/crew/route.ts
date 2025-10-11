// src/app/api/ops/crew/upsert/route.ts
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
 * Upsert a crew assignment for any role_code.
 * Body: { journey_id: UUID, vehicle_id: UUID, staff_id: UUID, role_code: string }
 * role_code should be one of your allowed codes (e.g. "CAPTAIN", "FIRST_MATE", "ENGINEER", "STEWARD").
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id, role_code } = (await req.json()) as {
      journey_id?: UUID;
      vehicle_id?: UUID;
      staff_id?: UUID;
      role_code?: string;
    };

    if (!journey_id || !vehicle_id || !staff_id || !role_code) {
      return NextResponse.json(
        { error: "journey_id, vehicle_id, staff_id and role_code are required" },
        { status: 400 }
      );
    }

    const sb = sbServer();

    const { data: rpcData, error: rpcErr, status: rpcStatus } = await sb.rpc(
      "api_upsert_crew_assignment",
      {
        p_journey_id: journey_id,
        p_vehicle_id: vehicle_id,
        p_staff_id: staff_id,
        p_role_code: role_code,
      }
    );

    if (rpcErr) {
      const msg = rpcErr.message || "RPC failed";
      const code = (rpcErr as any).code as string | undefined;

      if (code === "23505") {
        return NextResponse.json({ error: "Conflict (unique constraint)" }, { status: 409 });
      }
      if (/unauthorised|forbidden|permission/i.test(msg)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (/invalid|not found|eligible|operator/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 422 });
      }
      return NextResponse.json({ error: msg }, { status: rpcStatus || 500 });
    }

    // Try to extract assignment_id if returned
    const assignment_id: string | undefined =
      (Array.isArray(rpcData) ? rpcData?.[0]?.assignment_id : (rpcData as any)?.assignment_id) ??
      undefined;

    // Return minimal refreshed rows for this JV so UI can update
    const { data: vrows, error: vErr } = await sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id);

    if (vErr) {
      return NextResponse.json(
        { ok: true, assignment_id, view: [], note: "Assigned, but failed to refresh view" },
        { status: 200 }
      );
    }

    return NextResponse.json({ ok: true, assignment_id, view: vrows || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
