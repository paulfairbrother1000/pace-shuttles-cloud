import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// service client (bypasses RLS for server-side checks)
const svc = createClient(URL, SERVICE);

/* auth client (Next 15-safe cookies) */
async function getCookieStore() {
  const c: any = (cookies as any)();
  return typeof c?.then === "function" ? await c : c;
}
async function authClient() {
  const store = await getCookieStore();
  return createServerClient(URL, ANON, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) =>
        store.set({ name, value, ...options }),
      remove: (name: string, options: CookieOptions) =>
        store.set({ name, value: "", ...options }),
    },
  });
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

/**
 * GET: candidates + current assignment for a journey/vehicle
 * URL params: /api/operator/captains/:journeyId/:vehicleId
 *
 * Security: requires an operator_admin user for the operator that owns the vehicle.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { journeyId: string; vehicleId: string } }
) {
  try {
    const supa = await authClient();
    const { data: sess } = await supa.auth.getUser();
    const uid = sess?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // caller must be an operator_admin
    const { data: me, error: meErr } = await svc
      .from("users")
      .select("operator_admin, operator_id")
      .eq("id", uid)
      .maybeSingle();
    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
    if (!me?.operator_admin || !me?.operator_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // verify the vehicle belongs to caller's operator
    const { data: veh, error: vErr } = await svc
      .from("vehicles")
      .select("operator_id")
      .eq("id", params.vehicleId)
      .maybeSingle();
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 400 });
    if (!veh || veh.operator_id !== me.operator_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // current assignment (lead) for this journey+vehicle
    const { data: current, error: cErr } = await svc
      .from("journey_assignments")
      .select("id, staff_id, status_simple")
      .eq("journey_id", params.journeyId)
      .eq("vehicle_id", params.vehicleId)
      .eq("is_lead", true)
      .maybeSingle();
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });

    // candidates from helper function (already granted to authenticated)
    const { data: candidates, error: candErr } = await svc.rpc(
      "get_captain_candidates",
      { _journey: params.journeyId, _vehicle: params.vehicleId }
    );
    if (candErr) return NextResponse.json({ error: candErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      current: current ?? null,
      candidates: candidates ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
