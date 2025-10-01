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
 * Body can include:
 *   - preferred: boolean
 *   - is_active: boolean
 *
 * If preferred=true, clears other preferred assignments for the same route & operator.
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

    // If we're setting preferred=true, clear any other preferred for same route+operator
    if (updates.preferred === true) {
      const { data: current, error: curErr } = await db
        .from("route_vehicle_assignments")
        .select("id, route_id, vehicle_id, vehicles!inner(operator_id)")
        .eq("id", id)
        .single();

      if (curErr || !current) {
        return NextResponse.json({ error: curErr?.message || "Assignment not found" }, { status: 404 });
      }

      const routeId = current.route_id as string;
      const operatorId = (current as any).vehicles?.operator_id as string | null;

      if (!operatorId) {
        return NextResponse.json({ error: "Operator not found for this assignment’s vehicle" }, { status: 400 });
      }

      // Clear others
      const { data: toClear, error: listErr } = await db
        .from("route_vehicle_assignments")
        .select("id, vehicles!inner(operator_id)")
        .eq("route_id", routeId)
        .eq("preferred", true)
        .eq("vehicles.operator_id", operatorId);

      if (listErr) return NextResponse.json({ error: listErr.message }, { status: 400 });

      const idsToClear = (toClear || []).map((r: any) => r.id).filter((x: string) => x !== id);
      if (idsToClear.length) {
        const { error: clearErr } = await db
          .from("route_vehicle_assignments")
          .update({ preferred: false })
          .in("id", idsToClear);
        if (clearErr) return NextResponse.json({ error: clearErr.message }, { status: 400 });
      }
    }

    const { error: updErr } = await db
      .from("route_vehicle_assignments")
      .update(updates)
      .eq("id", id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await db
      .from("route_vehicle_assignments")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
