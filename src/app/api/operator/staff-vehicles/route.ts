// src/app/api/operator/staff-vehicles/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabaseServer"; // uses service role, bypasses RLS

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

/** GET ?operator_id=...&staff_id=...  → list vehicle_staff_prefs for a staff member */
export async function GET(req: NextRequest) {
  const operator_id = req.nextUrl.searchParams.get("operator_id");
  const staff_id = req.nextUrl.searchParams.get("staff_id");

  if (!operator_id || !staff_id) {
    return NextResponse.json({ error: "operator_id and staff_id required" }, { status: 400 });
  }

  const db = supabaseService();
  const { data, error } = await db
    .from("vehicle_staff_prefs")
    .select("id,operator_id,vehicle_id,staff_id,priority,is_lead_eligible")
    .eq("operator_id", operator_id)
    .eq("staff_id", staff_id)
    .order("priority", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

/** POST body: { operator_id, vehicle_id, staff_id, priority?, is_lead_eligible? } */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();

    for (const k of ["operator_id", "vehicle_id", "staff_id"]) {
      if (!b?.[k]) return NextResponse.json({ error: `${k} required` }, { status: 400 });
    }

    const payload = {
      operator_id: String(b.operator_id),
      vehicle_id: String(b.vehicle_id),
      staff_id: String(b.staff_id),
      priority: Number(b.priority ?? 3),
      is_lead_eligible: Boolean(b.is_lead_eligible ?? true),
    };

    const db = supabaseService();
    const { error } = await db.from("vehicle_staff_prefs").insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad Request" }, { status: 400 });
  }
}
