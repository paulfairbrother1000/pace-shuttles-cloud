import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, service);

export async function OPTIONS() {
  return NextResponse.json({ ok: true, methods: ["PATCH", "DELETE"] });
}

/**
 * PATCH /api/operator/route-vehicles/[id]
 * Body: { preferred?: boolean, is_active?: boolean }
 *
 * Matches DB constraint:
 *   unique (route_id) where preferred = true
 * So when setting preferred=true we first clear ANY other preferred on the SAME route.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));

    const updates: Record<string, any> = {};
    if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
    if (typeof body.preferred === "boolean") updates.preferred = body.preferred;

    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // If we're setting preferred=true, clear OTHER preferred assignments on the SAME route
    if (updates.preferred === true) {
      const { data: current, error: curErr } = await db
        .from("route_vehicle_assignments")
        .select("id, route_id, preferred")
        .eq("id", id)
        .single();

      if (curErr || !current) {
        return NextResponse.json({ error: curErr?.message || "Assignment not found" }, { status: 404 });
      }

      const routeId = current.route_id as string;

      // Clear any other preferred assignments on this route (excluding this one)
      const { error: clearErr } = await db
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", routeId)
        .eq("preferred", true)
        .neq("id", id);

      if (clearErr) {
        return NextResponse.json({ error: clearErr.message }, { status: 400 });
      }
    }

    // Apply requested updates to the target assignment
    const { error: updErr } = await db
      .from("route_vehicle_assignments")
      .update(updates)
      .eq("id", id);

    if (updErr) {
      // Unique violation would show up as 23505 if we somehow didn't clear first
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await db.from("route_vehicle_assignments").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
