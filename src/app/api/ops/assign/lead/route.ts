// src/app/api/ops/assign/lead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import sendMail from "@/lib/mailer";

const AVAIL_WINDOW_MS = 6 * 60 * 60 * 1000;

/* ---------- Supabase helper ---------- */
function sbFromCookies() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => jar.get(n)?.value,
        set: (n: string, v: string, o: any) => { try { jar.set({ name: n, value: v, ...o }); } catch {} },
        remove: (n: string, o: any) => { try { jar.set({ name: n, value: "", ...o }); } catch {} },
      },
    }
  );
}

/* ---------- Types ---------- */
type StaffRow = {
  id: string;
  operator_id: string;
  active: boolean | null;
  jobrole: string | null;
  user_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/* ---------- Email lookup (optional) ---------- */
async function getStaffEmail(sb: any, user_id: string | null): Promise<string | null> {
  if (!user_id) return null;
  try {
    const { data } = await sb.from("profiles").select("email").eq("id", user_id).maybeSingle();
    return data?.email ?? null;
  } catch { return null; }
}

/* ---------- Fair-use picker ---------- */
async function fairUsePickCaptain(sb: any, operator_id: string, departureISO: string): Promise<StaffRow | null> {
  const { data: staffRows } = await sb
    .from("operator_staff")
    .select("id, operator_id, active, jobrole, user_id, first_name, last_name")
    .eq("operator_id", operator_id)
    .eq("active", true);

  const all = (staffRows as StaffRow[] | null) ?? [];
  if (!all.length) return null;

  const capFirst = all.filter(s => (s.jobrole || "").toLowerCase().includes("captain"));
  const others = all.filter(s => !(s.jobrole || "").toLowerCase().includes("captain"));
  const pool = capFirst.concat(others);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentLeads } = await sb
    .from("journey_assignments")
    .select("staff_id, assigned_at")
    .eq("is_lead", true)
    .gte("assigned_at", since);

  const count30 = new Map<string, number>();
  (recentLeads || []).forEach((r: any) => {
    count30.set(r.staff_id, (count30.get(r.staff_id) || 0) + 1);
  });

  const { data: lifetimeLeads } = await sb
    .from("journey_assignments")
    .select("staff_id, assigned_at")
    .eq("is_lead", true)
    .order("assigned_at", { ascending: false })
    .limit(2000);

  const last20Count = new Map<string, number>();
  if (lifetimeLeads?.length) {
    const byStaff = new Map<string, any[]>();
    lifetimeLeads.forEach((r: any) => {
      const arr = byStaff.get(r.staff_id) || [];
      arr.push(r);
      byStaff.set(r.staff_id, arr);
    });
    for (const [sid, arr] of byStaff.entries()) {
      last20Count.set(sid, Math.min(arr.length, 20));
    }
  }

  function scoreFor(sid: string) {
    return (count30.get(sid) || 0) * 2 + (last20Count.get(sid) || 0);
  }

  const dep = new Date(departureISO).getTime();

  for (const s of pool.sort((a, b) => scoreFor(a.id) - scoreFor(b.id))) {
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

    if (!busy) return s;
  }

  return null;
}

/* ---------- Route ---------- */
export async function POST(req: NextRequest) {
  const sb = sbFromCookies();

  const payload = await req.json().catch(() => ({}));
  const journey_id = (payload?.journey_id || "").trim();
  const vehicle_id = (payload?.vehicle_id || "").trim();
  const requested_staff_id = (payload?.staff_id || "").trim() || null;

  if (!journey_id || !vehicle_id) {
    return NextResponse.json({ error: "journey_id and vehicle_id are required" }, { status: 400 });
  }

  const { data: j } = await sb
    .from("journeys")
    .select("id, route_id, operator_id, departure_ts, is_active")
    .eq("id", journey_id)
    .maybeSingle();
  if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  const { data: v } = await sb
    .from("vehicles")
    .select("id, operator_id, active, name")
    .eq("id", vehicle_id)
    .maybeSingle();
  if (!v) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  if (v.active === false) return NextResponse.json({ error: "Vehicle inactive" }, { status: 422 });
  if (v.operator_id !== j.operator_id) {
    return NextResponse.json({ error: "Vehicle not owned by journey operator" }, { status: 422 });
  }

  const { data: existingLead } = await sb
    .from("journey_assignments")
    .select("id, completed_at")
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id)
    .eq("is_lead", true)
    .limit(1);

  if (existingLead && existingLead.length && !existingLead[0].completed_at) {
    return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
  }

  let staff: StaffRow | null = null;

  if (requested_staff_id) {
    const { data: s } = await sb
      .from("operator_staff")
      .select("id, operator_id, active, jobrole, user_id, first_name, last_name")
      .eq("id", requested_staff_id)
      .maybeSingle();
    if (!s) return NextResponse.json({ error: "Staff not found" }, { status: 422 });
    if (s.operator_id !== j.operator_id) return NextResponse.json({ error: "Wrong operator" }, { status: 422 });
    if (s.active === false) return NextResponse.json({ error: "Staff inactive" }, { status: 422 });

    const dep = new Date(j.departure_ts).getTime();
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
    if (busy) return NextResponse.json({ error: "Staff not available" }, { status: 422 });

    staff = s;
  } else {
    staff = await fairUsePickCaptain(sb, j.operator_id, j.departure_ts);
    if (!staff) return NextResponse.json({ error: "No eligible Lead available" }, { status: 422 });
  }

  await sb
    .from("journey_assignments")
    .delete()
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id)
    .eq("is_lead", true);

  const { data: ins, error: insErr } = await sb
    .from("journey_assignments")
    .insert({
      journey_id,
      vehicle_id,
      staff_id: staff.id,
      is_lead: true,
      status_simple: "allocated",
      assigned_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Notify operator admin + (if possible) captain
  try {
    const { data: op } = await sb.from("operators").select("admin_email,name").eq("id", j.operator_id).maybeSingle();

    const captainEmail = await getStaffEmail(sb, staff.user_id);
    const to: string[] = [];
    if (op?.admin_email) to.push(op.admin_email);
    if (captainEmail) to.push(captainEmail);

    if (to.length && sendMail) {
      const when = new Date(j.departure_ts).toLocaleString();
      const subj = `[Lead Assigned] ${v.name} — ${when}`;
      const html = `
        <p>Lead assigned for upcoming journey.</p>
        <ul>
          <li><b>Vehicle</b>: ${v.name}</li>
          <li><b>Departure</b>: ${when}</li>
          <li><b>Captain</b>: ${(staff.first_name || "")} ${(staff.last_name || "")}</li>
        </ul>
      `;
      await sendMail({ to, subject: subj, html, text: `Lead assigned: ${v.name} at ${when}` });
    }
  } catch {}

  return NextResponse.json({ ok: true, assignment_id: ins?.id });
}
