import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Assign (or reassign) a lead crew member to a journey+vehicle.
 * Body: { journey_id: string, vehicle_id: string, staff_id?: string }
 * Returns: 200 { ok: true, assignment_id } | 409 already has a lead | 422 invalid
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id } = await req.json();

    if (!journey_id || !vehicle_id) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 }
      );
    }

    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => cookieStore.get(name)?.value,
          set: (name: string, value: string, options: any) =>
            cookieStore.set({ name, value, ...options }),
          remove: (name: string, options: any) =>
          cookieStore.set({ name, value: "", ...options }),
        },
      }
    );

    // 1) If a lead already exists and is still active, refuse.
    {
      const { data: existing, error: existErr } = await supabase
        .from("journey_assignments")
        .select("id")
        .eq("journey_id", journey_id)
        .eq("vehicle_id", vehicle_id)
        .eq("is_lead", true)
        .is("completed_at", null)
        .limit(1);

      if (existErr) {
        return NextResponse.json(
          { error: existErr.message || "Check failed" },
          { status: 500 }
        );
      }
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: "Lead already assigned." },
          { status: 409 }
        );
      }
    }

    // 2) Optional: if staff_id specified, make sure the staff exists and is active
    if (staff_id) {
      const { data: s, error: sErr } = await supabase
        .from("operator_staff")
        .select("id, active")
        .eq("id", staff_id)
        .maybeSingle();

      if (sErr) {
        return NextResponse.json(
          { error: sErr.message || "Staff lookup failed" },
          { status: 500 }
        );
      }
      if (!s || s.active === false) {
        return NextResponse.json(
          { error: "Staff is not available/active." },
          { status: 422 }
        );
      }
    }

    // 3) Insert new lead assignment (role_id can be null; views derive labels)
    const nowIso = new Date().toISOString();
    const { data: ins, error: insErr } = await supabase
      .from("journey_assignments")
      .insert({
        journey_id,
        vehicle_id,
        staff_id: staff_id ?? null,
        is_lead: true,
        status_simple: "allocated",
        assigned_at: nowIso,
        created_at: nowIso,
      })
      .select("id")
      .single();

    if (insErr) {
      return NextResponse.json(
        { error: insErr.message || "Insert failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, assignment_id: ins?.id }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
