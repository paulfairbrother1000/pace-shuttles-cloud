import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * POST /api/ops/assign/lead
 * Body: { journey_id: UUID, vehicle_id: UUID, staff_id?: UUID }
 * - If staff_id omitted, server picks best eligible lead using Fair-Use.
 * - Enforces 30-min pre/post availability buffer.
 * - If a valid lead already exists, returns 409 (unless replacing with explicit staff_id).
 * Responses:
 *  200 { ok: true, assignment_id }
 *  404 if journey/vehicle missing
 *  409 if lead already set and no override requested
 *  422 if chosen staff ineligible/unavailable
 */

const PREPOST_BUFFER_MIN = 30;

function getSb() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return jar.get(name)?.value; },
        set(name: string, value: string, options: any) { try { jar.set({ name, value, ...options }); } catch {} },
        remove(name: string, options: any) { try { jar.set({ name, value: "", ...options }); } catch {} },
      },
    }
  );
}

export async function POST(req: NextRequest) {
  const sb = getSb();
  const body = await req.json().catch(() => ({}));
  const journey_id = (body?.journey_id || "").trim();
  const vehicle_id = (body?.vehicle_id || "").trim();
  const explicit_staff_id = (body?.staff_id || "").trim() || null;

  if (!journey_id || !vehicle_id) {
    return NextResponse.json({ error: "journey_id and vehicle_id required" }, { status: 400 });
  }

  // --- Load journey, vehicle, operator context
  const { data: j } = await sb.from("journeys")
    .select("id, route_id, departure_ts, operator_id")
    .eq("id", journey_id).maybeSingle();
  if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  const { data: v } = await sb.from("vehicles")
    .select("id, operator_id")
    .eq("id", vehicle_id).maybeSingle();
  if (!v) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  if (!v.operator_id || v.operator_id !== j.operator_id) {
    return NextResponse.json({ error: "Vehicle not owned by journey operator" }, { status: 422 });
  }

  // --- If there is already a valid lead, short-circuit unless we’re explicitly overriding
  // v_crew_assignments_min exposes role_label; Crew = non-lead. Anything else is lead.
  const { data: existing } = await sb
    .from("v_crew_assignments_min")
    .select("assignment_id, staff_id, role_label, status_simple")
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id);

  const existingLead = (existing || []).find(r => (r.role_label ?? "").toLowerCase() !== "crew");
  if (existingLead && !explicit_staff_id) {
    return NextResponse.json({ error: "Lead already assigned", existing_assignment_id: existingLead.assignment_id }, { status: 409 });
  }

  // --- Compute time window for availability (±30 mins buffer)
  const dep = new Date(j.departure_ts);
  const start = new Date(dep.getTime() - PREPOST_BUFFER_MIN * 60 * 1000);
  const end   = new Date(dep.getTime() + PREPOST_BUFFER_MIN * 60 * 1000);

  // --- Candidate set
  let candidateStaffIds: string[] = [];
  if (explicit_staff_id) {
    candidateStaffIds = [explicit_staff_id];
  } else {
    // Pull operator staff who are active and *lead-eligible* for the journey type:
    // We use v_operator_staff_min -> role_label and type_id to ensure eligibility.
    const { data: staffMin } = await sb
      .from("v_operator_staff_min")
      .select("staff_id, operator_id, role_label, status, is_active, type_id")
      .eq("operator_id", v.operator_id);

    // Journey type (for eligibility by type)
    const { data: route } = await sb.from("routes").select("journey_type_id").eq("id", j.route_id).maybeSingle();
    const journeyTypeId = route?.journey_type_id ?? null;

    const leadRoleLabels = new Set(["Captain","Driver","Pilot"]); // lead roles
    candidateStaffIds = (staffMin || [])
      .filter(s =>
        s.is_active === true &&
        leadRoleLabels.has((s.role_label || "").trim()) &&
        (journeyTypeId ? (s.type_id === journeyTypeId) : true)
      )
      .map(s => s.staff_id as string);

    if (candidateStaffIds.length === 0) {
      return NextResponse.json({ error: "No eligible staff found" }, { status: 422 });
    }

    // Filter by fair-use (we’ll rank later) and availability next.
  }

  // --- Availability: no conflicting assignments inside [start, end]
  // We treat "allocated" and "confirmed" as blocking.
  const { data: allAssigns } = await sb
    .from("v_crew_assignments_min")
    .select("staff_id, departure_ts, status_simple");

  const busy = new Set<string>();
  (allAssigns || []).forEach(a => {
    if (!a.departure_ts) return;
    const t = new Date(a.departure_ts as any).getTime();
    const inWindow = t >= start.getTime() && t <= end.getTime();
    if (inWindow && (a.status_simple === "allocated" || a.status_simple === "confirmed")) {
      busy.add(a.staff_id as string);
    }
  });

  candidateStaffIds = candidateStaffIds.filter(id => !busy.has(id));
  if (!candidateStaffIds.length) {
    return NextResponse.json({ error: "No available staff for the time window" }, { status: 422 });
  }

  // --- If server picks, apply fair-use ranking
  let chosen = explicit_staff_id;
  if (!chosen) {
    const { data: ledger } = await sb
      .from("captain_fairuse_ledger")
      .select("staff_id, window_start, window_end, assignments")
      .eq("operator_id", v.operator_id);

    // Rank: ascending by assignments in the current active window (hybrid logic maintained by SQL policy).
    const counts = new Map<string, number>();
    (ledger || []).forEach(r => counts.set(r.staff_id as string, Number(r.assignments || 0)));

    candidateStaffIds.sort((a, b) => {
      const ca = counts.get(a) ?? 0;
      const cb = counts.get(b) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.localeCompare(b);
    });

    chosen = candidateStaffIds[0];
  }

  // --- If replacing an existing lead, remove the old one first
  if (existingLead && chosen && existingLead.staff_id !== chosen) {
    await sb.from("journey_assignments")
      .delete()
      .eq("id", existingLead.assignment_id);
  }

  // --- Upsert the lead into journey_assignments (non-crew == lead)
  // We mark status_simple = 'allocated' (T-72) initially.
  const insert = {
    journey_id,
    vehicle_id,
    staff_id: chosen,
    is_lead: true,
    status_simple: "allocated",
    assigned_at: new Date().toISOString(),
  };

  const { data: ins, error: insErr } = await sb
    .from("journey_assignments")
    .insert(insert)
    .select("id")
    .single();

  if (insErr) {
    // if a unique violation exists in your schema, you can fall back to update
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, assignment_id: ins?.id });
}
