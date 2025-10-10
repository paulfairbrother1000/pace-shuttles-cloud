import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import sendMail from "@/lib/mailer";

const AVAIL_WINDOW_MS = 6 * 60 * 60 * 1000;

function sbFromCookies() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => jar.get(n)?.value } }
  );
}

async function getStaffEmail(sb: any, user_id: string | null): Promise<string | null> {
  if (!user_id) return null;
  try {
    const { data } = await sb.from("profiles").select("email").eq("id", user_id).maybeSingle();
    return data?.email ?? null;
  } catch { return null; }
}

/**
 * POST /api/ops/assign/crew
 * {
 *   journey_id: UUID,
 *   vehicle_id: UUID,
 *   staff_ids: UUID[]   // one or more crew members
 * }
 */
export async function POST(req: NextRequest) {
  const sb = sbFromCookies();
  const body = await req.json().catch(() => ({}));
  const journey_id = (body?.journey_id || "").trim();
  const vehicle_id = (body?.vehicle_id || "").trim();
  const staff_ids: string[] = Array.isArray(body?.staff_ids) ? body.staff_ids : [];

  if (!journey_id || !vehicle_id || !staff_ids.length) {
    return NextResponse.json({ error: "journey_id, vehicle_id and staff_ids are required" }, { status: 400 });
  }

  const { data: j } = await sb.from("journeys")
    .select("id, operator_id, departure_ts").eq("id", journey_id).maybeSingle();
  if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  const { data: v } = await sb.from("vehicles")
    .select("id, operator_id, name, active").eq("id", vehicle_id).maybeSingle();
  if (!v) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  if (v.active === false) return NextResponse.json({ error: "Vehicle inactive" }, { status: 422 });
  if (v.operator_id !== j.operator_id) {
    return NextResponse.json({ error: "Vehicle not owned by journey operator" }, { status: 422 });
  }

  // Validate staff belong to operator + active + available
  const { data: staffRows } = await sb
    .from("operator_staff")
    .select("id, operator_id, active, user_id, first_name, last_name")
    .in("id", staff_ids);

  if (!staffRows?.length || staffRows.length !== staff_ids.length) {
    return NextResponse.json({ error: "Some staff not found" }, { status: 422 });
  }
  if (staffRows.some((s: any) => s.operator_id !== j.operator_id)) {
    return NextResponse.json({ error: "Staff operator mismatch" }, { status: 422 });
  }
  if (staffRows.some((s: any) => s.active === false)) {
    return NextResponse.json({ error: "Some staff are inactive" }, { status: 422 });
  }

  const dep = new Date(j.departure_ts).getTime();
  const notAvail: string[] = [];
  for (const s of staffRows) {
    const { data: conflicts } = await sb
      .from("v_crew_assignments_min")
      .select("staff_id, departure_ts, status_simple")
      .eq("staff_id", s.id);
    const busy = (conflicts || []).some((a: any) => {
      if (!a.departure_ts) return false;
      const t = new Date(a.departure_ts).getTime();
      const active = a.status_simple === "allocated" || a.status_simple === "confirmed";
      return active && Math.abs(t - dep) < AVAIL_WINDOW_MS;
    });
    if (busy) notAvail.push(s.id);
  }
  if (notAvail.length) {
    return NextResponse.json({ error: "One or more staff unavailable", staff_ids: notAvail }, { status: 422 });
  }

  // Insert any missing crew rows
  for (const s of staffRows) {
    const { data: exists } = await sb
      .from("journey_crew_assignments")
      .select("id")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("staff_id", s.id)
      .limit(1);
    if (!exists?.length) {
      const { error } = await sb.from("journey_crew_assignments").insert({
        journey_id, vehicle_id, staff_id: s.id, status: "allocated", assigned_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Notify operator admin + crew (if we can resolve emails)
  try {
    const { data: op } = await sb.from("operators").select("admin_email,name").eq("id", j.operator_id).maybeSingle();
    const to: string[] = [];
    if (op?.admin_email) to.push(op.admin_email);

    for (const s of staffRows) {
      const email = await getStaffEmail(sb, s.user_id);
      if (email) to.push(email);
    }

    if (to.length && sendMail) {
      const when = new Date(j.departure_ts).toLocaleString();
      const subj = `[Crew Assigned] ${v.name} — ${when}`;
      const list = staffRows.map((s: any) => `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim()).join(", ");
      const html = `
        <p>Crew assigned for upcoming journey.</p>
        <ul>
          <li><b>Vehicle</b>: ${v.name}</li>
          <li><b>Departure</b>: ${when}</li>
          <li><b>Crew</b>: ${list || "—"}</li>
        </ul>
      `;
      await sendMail({ to, subject: subj, html, text: `Crew assigned: ${list}` });
    }
  } catch {}

  return NextResponse.json({ ok: true });
}
