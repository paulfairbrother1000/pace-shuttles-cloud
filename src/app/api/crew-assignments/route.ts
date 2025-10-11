export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function sb(req: NextRequest) {
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (name: string) => cookieStore.get(name)?.value,
      set: (name: string, value: string, options: any) =>
        cookieStore.set({ name, value, ...options }),
      remove: (name: string, options: any) =>
        cookieStore.set({ name, value: "", ...options }),
    },
  });
}

// GET ?journey_id=...&vehicle_id=...
export async function GET(req: NextRequest) {
  const supabase = sb(req);
  const { searchParams } = new URL(req.url);
  const journey_id = searchParams.get("journey_id");
  const vehicle_id = searchParams.get("vehicle_id");

  const query = supabase
    .from("v_journey_crew")
    .select("*")
    .order("role_code", { ascending: true })
    .order("crew_name", { ascending: true });

  const { data, error } =
    journey_id && vehicle_id
      ? await query.eq("journey_id", journey_id).eq("vehicle_id", vehicle_id)
      : await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const supabase = sb(req);
  const body = await req.json();
  const { journey_id, vehicle_id, crew_id, role_code } = body;

  const { data, error } = await supabase.rpc("api_upsert_crew_assignment", {
    p_journey_id: journey_id,
    p_vehicle_id: vehicle_id,
    p_crew_id: crew_id,
    p_role_code: role_code,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = sb(req);
  const { searchParams } = new URL(req.url);
  const journey_id = searchParams.get("journey_id");
  const vehicle_id = searchParams.get("vehicle_id");
  const crew_id = searchParams.get("crew_id");
  const role_code = searchParams.get("role_code");

  const { error } = await supabase.rpc("api_delete_crew_assignment", {
    p_journey_id: journey_id,
    p_vehicle_id: vehicle_id,
    p_crew_id: crew_id,
    p_role_code: role_code,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
