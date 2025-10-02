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
      .select("operator_id")
      .eq("id", vehicleId)
      .single();
    if (vErr || !veh) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
    if (myOpId && veh.operator_id !== myOpId) {
      return NextResponse.json({ error: "Vehicle is not yours" }, { status: 403 });
    }

    const upd = await admin
      .from("route_vehicle_assignments")
      .update({ is_active: false, preferred: false })
      .eq("route_id", routeId)
      .eq("vehicle_id", vehicleId);
    if (upd.error) throw upd.error;

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Server error" }, { status: 500 });
  }
}

export {};
