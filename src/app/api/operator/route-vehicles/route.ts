import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!; // service role bypasses RLS

// Fail early if env is missing (prevents vague 500s)
function assertEnv() {
  if (!url) throw new Error("Server misconfig: NEXT_PUBLIC_SUPABASE_URL is missing");
  if (!service) throw new Error("Server misconfig: SUPABASE_SERVICE_ROLE_KEY is missing");
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true, methods: ["POST"] });
}

/**
 * Accepts either:
 *  - { route_id: string, vehicle_id: string, is_active?: boolean }
 *  - { route_id: string, vehicle_ids: string[], is_active?: boolean }   <-- bulk
 *
 * Upserts to avoid duplicate key errors on (route_id, vehicle_id).
 */
export async function POST(req: Request) {
  try {
    assertEnv();
    const db = createClient(url, service);

    const body = await req.json().catch(() => ({}));

    const route_id = body.route_id as string | undefined;
    const vehicle_id = body.vehicle_id as string | undefined;
    const vehicle_ids = body.vehicle_ids as string[] | undefined;
    const is_active = typeof body.is_active === "boolean" ? body.is_active : true;

    if (!route_id) {
      return NextResponse.json({ error: "route_id is required" }, { status: 400 });
    }
    if (!vehicle_id && !Array.isArray(vehicle_ids)) {
      return NextResponse.json({ error: "Provide vehicle_id or vehicle_ids[]" }, { status: 400 });
    }

    // Normalize rows to insert
    const rows =
      Array.isArray(vehicle_ids)
        ? vehicle_ids.map((vid) => ({ route_id, vehicle_id: vid, is_active }))
        : [{ route_id, vehicle_id: vehicle_id!, is_active }];

    // Upsert to handle duplicates gracefully (unique(route_id, vehicle_id))
    const { error, data } = await db
      .from("route_vehicle_assignments")
      .upsert(rows, { onConflict: "route_id,vehicle_id" })
      .select("id, route_id, vehicle_id, is_active, preferred");

    if (error) {
      // Map common Postgres errors to friendly HTTP codes
      const code = (error as any)?.code;
      if (code === "23503") {
        // foreign key violation
        return NextResponse.json(
          { error: "Invalid route_id or vehicle_id (foreign key not found)" },
          { status: 400 }
        );
      }
      if (code === "42501") {
        // insufficient privilege (RLS/permissions)
        return NextResponse.json(
          { error: "Not authorized to assign vehicles to this route" },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      count: data?.length ?? 0,
      assignments: data ?? [],
    });
  } catch (e: any) {
    // Bubble up a clear server-side message so the UI can show it
    return NextResponse.json(
      { error: e?.message ?? "Unhandled server error" },
      { status: 500 }
    );
  }
}

export {};
