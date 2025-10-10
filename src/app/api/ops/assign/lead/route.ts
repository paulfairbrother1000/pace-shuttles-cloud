// src/app/api/ops/assign/lead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
// IMPORTANT: your mailer exports are named, not default:
import { sendMail } from "@/lib/mailer"; // ✅ named import

export async function POST(req: NextRequest) {
  const { journey_id, vehicle_id, staff_id } = await req.json().catch(() => ({}));
  if (!journey_id || !vehicle_id) {
    return NextResponse.json({ error: "journey_id and vehicle_id required" }, { status: 400 });
  }

  const cookieStore = cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value } }
  );

  // Basic operator auth/context (best-effort)
  const { data: ures } = await sb.auth.getUser();
  if (!ures?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1) validate journey/vehicle
  const { data: j } = await sb
    .from("journeys")
    .select("id, route_id, departure_ts")
    .eq("id", journey_id)
    .maybeSingle();
  if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  const { data: v } = await sb
    .from("vehicles")
    .select("id, operator_id, name")
    .eq("id", vehicle_id)
    .maybeSingle();
  if (!v) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  // 2) if staff_id omitted, pick an eligible captain (very simple fallback)
  let targetStaffId = staff_id as string | undefined;
  if (!targetStaffId) {
    const { data: staff } = await sb
      .from("operator_staff")
      .select("id, active, jobrole")
      .eq("operator_id", v.operator_id)
      .eq("active", true);
    const captains = (staff || []).filter(s => (s.jobrole || "").toLowerCase() === "captain");
    targetStaffId = captains[0]?.id;
    if (!targetStaffId) {
      return NextResponse.json({ error: "No eligible captain found" }, { status: 422 });
    }
  }

  // 3) ensure not already assigned a lead (role != Crew) for this journey+vehicle
  const { data: exists } = await sb
    .from("journey_assignments")
    .select("id, role_label, status_simple")
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id)
    .neq("role_label", "Crew")
    .limit(1);
  if (exists && exists.length) {
    return NextResponse.json({ error: "Lead already exists" }, { status: 409 });
  }

  // 4) insert/allocate lead
  const { data: ins, error: insErr } = await sb
    .from("journey_assignments")
    .insert({
      journey_id,
      vehicle_id,
      staff_id: targetStaffId,
      role_label: "Captain",
      status_simple: "allocated",
      assigned_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // 5) optional: email notification (safe-guarded)
  try {
    // You can adjust subject/html templates as you like
    await sendMail({
      to: [], // fill if you want an immediate captain mail here; otherwise leave empty
      subject: "New assignment",
      html: `<p>You have been assigned as Captain.</p>`,
    });
  } catch {
    // ignore mail errors
  }

  return NextResponse.json({ ok: true, assignment_id: ins?.id });
}
