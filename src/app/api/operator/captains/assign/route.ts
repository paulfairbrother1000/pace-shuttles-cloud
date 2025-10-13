import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const svc = createClient(URL, SERVICE);

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
 * POST body: { journey_id, vehicle_id, staff_id }
 * Upserts the *lead* journey assignment. Sets status_simple = 'allocated' and assigned_at = now().
 * If another lead is present for the same journey+vehicle, it is updated to the new staff.
 *
 * Security: operator_admin of the vehicle's operator.
 */
export async function POST(req: NextRequest) {
  try {
    const supa = await authClient();
    const { data: sess } = await supa.auth.getUser();
    const uid = sess?.user?.id;
    if (!uid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { journey_id, vehicle_id, staff_id } = body || {};

    if (!journey_id || !vehicle_id || !staff_id) {
      return NextResponse.json({ error: "journey_id, vehicle_id, staff_id required" }, { status: 400 });
    }

    // caller must be operator_admin and own the vehicle
    const { data: me, error: meErr } = await svc
      .from("users")
      .select("operator_admin, operator_id")
      .eq("id", uid)
      .maybeSingle();
    if (meErr) return NextResponse.json({ error: meErr.message }, { status: 400 });
    if (!me?.operator_admin || !me?.operator_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: veh, error: vErr } = await svc
      .from("vehicles")
      .select("operator_id")
      .eq("id", vehicle_id)
      .maybeSingle();
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 400 });
    if (!veh || veh.operator_id !== me.operator_id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // ensure staff is actually a candidate for this vehicle (optional but safer)
    const { data: candid, error: candErr } = await svc
      .from("vehicle_staff_prefs")
      .select("id")
      .eq("vehicle_id", vehicle_id)
      .eq("staff_id", staff_id)
      .maybeSingle();
    if (candErr) return NextResponse.json({ error: candErr.message }, { status: 400 });

    if (!candid) {
      return NextResponse.json({ error: "Staff is not configured for this vehicle" }, { status: 400 });
    }

    // existing lead assignment?
    const { data: existing, error: exErr } = await svc
      .from("journey_assignments")
      .select("id, staff_id")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("is_lead", true)
      .maybeSingle();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

    if (existing) {
      // update if different
      if (existing.staff_id !== staff_id) {
        const { error: updErr } = await svc
          .from("journey_assignments")
          .update({
            staff_id,
            status_simple: "allocated",
            assigned_at: new Date().toISOString(),
            confirmed_at: null,
          })
          .eq("id", existing.id);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
      }
    } else {
      // insert new lead assignment
      const { error: insErr } = await svc.from("journey_assignments").insert({
        journey_id,
        vehicle_id,
        staff_id,
        is_lead: true,
        status_simple: "allocated",
        assigned_at: new Date().toISOString(),
      });
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
