import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(url, service);

export async function OPTIONS() {
  return NextResponse.json({ ok: true, methods: ["POST"] });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { route_id, vehicle_id, is_active = true } = body || {};
    if (!route_id || !vehicle_id) {
      return NextResponse.json({ error: "route_id and vehicle_id are required" }, { status: 400 });
    }

    const { error } = await db
      .from("route_vehicle_assignments")
      .insert({ route_id, vehicle_id, is_active });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
