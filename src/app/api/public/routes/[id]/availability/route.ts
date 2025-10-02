import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(url, anon);

export async function OPTIONS() {
  return NextResponse.json({ ok: true, methods: ["GET"] });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;

    // Return the boats assigned to this route (and which one is preferred)
    const { data, error } = await db
      .from("route_vehicle_assignments")
      .select("id, vehicle_id, is_active, preferred, vehicles(id, name, minseats, maxseats)")
      .eq("route_id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      route_id: id,
      assignments: data || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export {};
