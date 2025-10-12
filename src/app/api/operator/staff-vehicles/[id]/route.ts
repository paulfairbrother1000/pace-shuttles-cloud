// src/app/api/operator/staff-vehicles/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

/** PATCH body may include { priority?, is_lead_eligible? } */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const b = await req.json();
    const update: Record<string, any> = {};
    if ("priority" in b) update.priority = Number(b.priority);
    if ("is_lead_eligible" in b) update.is_lead_eligible = Boolean(b.is_lead_eligible);

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = supabaseService();
    const { error } = await db.from("vehicle_staff_prefs").update(update).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad Request" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const db = supabaseService();
  const { error } = await db.from("vehicle_staff_prefs").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
