export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

async function serverSSROnly() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => cookieStore.get(n)?.value,
        set() {},
        remove() {},
      },
    }
  );
}
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { routeId, vehicleId } = await req.json();
    if (!routeId || !vehicleId) {
      return NextResponse.json({ error: "Missing routeId or vehicleId" }, { status: 400 });
    }

    const sb = await serverSSROnly();
    const { data: auth } = await sb.auth.getUser();
    const email = auth?.user?.email?.toLowerCase();
    if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: ops } = await sb
      .from("operators")
      .select("id")
      .ilike("admin_email", email)
      .limit(1);
    const myOpId = ops && ops.length ? ops[0].id : null;

    const { data: veh, error: vErr } = await admin
      .from("vehicles")
      .select("operator_id,active")
      .eq("id", vehicleId)
      .single();
    if (vErr || !veh) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    if (myOpId && veh.operator_id !== myOpId) {
      return NextResponse.json({ error: "Vehicle is not yours" }, { status: 403 });
    }
    if (veh.active === false) {
      return NextResponse.json({ error: "Vehicle is inactive" }, { status: 400 });
    }

    const clear = await admin
      .from("route_vehicle_assignments")
      .update({ preferred: false })
      .eq("route_id", routeId)
      .eq("preferred", true);
    if (clear.error) throw clear.error;

    const up = await admin
      .from("route_vehicle_assignments")
      .upsert([{ route_id: routeId, vehicle_id: vehicleId, is_active: true, preferred: true }], {
        onConflict: "route_id,vehicle_id",
      })
      .select("route_id,vehicle_id,is_active,preferred")
      .single();
    if (up.error) throw up.error;

    return NextResponse.json(up.data, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Server error" }, { status: 500 });
  }
}

export {};
