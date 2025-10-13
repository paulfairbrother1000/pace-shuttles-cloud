import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- Supabase setup ---------- */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

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

/* ---------- Helper: auto-assign next lead (priority + fair-use) ---------- */
async function autoAssignNextLead(params: {
  operator_id: string;
  journey_id: string;
  vehicle_id: string;
}) {
  const { operator_id, journey_id, vehicle_id } = params;

  // candidates: prefs joined with staff (active + email optional)
  const { data: prefs, error: pErr } = await db
    .from("vehicle_staff_prefs")
    .select("staff_id, priority, is_lead_eligible")
    .eq("operator_id", operator_id)
    .eq("vehicle_id", vehicle_id);
  if (pErr || !prefs || prefs.length === 0) return { ok: false, reason: "no_candidates" as const };

  // get active staff + emails
  const staffIds = Array.from(new Set(prefs.map((p) => p.staff_id)));
  const { data: staffRows, error: sErr } = await db
    .from("operator_staff")
    .select("id, active, email")
    .in("id", staffIds);
  if (sErr) return { ok: false, reason: "staff_lookup_failed" as const };

  // availability filter (simple: must be active; advanced blackout checks can be added later)
  const activeSet = new Set(staffRows?.filter((s) => s.active !== false).map((s) => s.id) ?? []);
  const candidates = prefs
    .filter((p) => p.is_lead_eligible && activeSet.has(p.staff_id))
    .map((p) => ({ staff_id: p.staff_id, priority: Number(p.priority || 3) }));

  if (candidates.length === 0) return { ok: false, reason: "no_eligible" as const };

  // fair-use: count confirmed wins for this vehicle/operator
  const { data: wins, error: wErr } = await db
    .from("captain_fairuse_ledger")
    .select("staff_id, confirmed, assigned_at")
    .eq("operator_id", operator_id)
    .eq("vehicle_id", vehicle_id)
    .eq("confirmed", true);
  if (wErr) return { ok: false, reason: "ledger_failed" as const };

  const winCount = new Map<string, number>();
  const lastWinAt = new Map<string, string>(); // ISO
  (wins || []).forEach((r) => {
    const sid = (r as any).staff_id as string;
    winCount.set(sid, (winCount.get(sid) || 0) + 1);
    const ts = (r as any).assigned_at as string | null;
    if (ts && (!lastWinAt.has(sid) || new Date(ts) > new Date(lastWinAt.get(sid)!))) {
      lastWinAt.set(sid, ts);
    }
  });

  // order: priority ASC, winCount ASC, lastWinAt ASC (older last win wins), then staff_id ASC
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ca = winCount.get(a.staff_id) || 0;
    const cb = winCount.get(b.staff_id) || 0;
    if (ca !== cb) return ca - cb;
    const la = lastWinAt.get(a.staff_id);
    const lb = lastWinAt.get(b.staff_id);
    if (la && lb) return new Date(la).getTime() - new Date(lb).getTime();
    if (la && !lb) return 1;  // b never won → prefer b
    if (!la && lb) return -1; // a never won → prefer a
    return a.staff_id.localeCompare(b.staff_id);
  });

  const chosen = candidates[0];

  // guard: ensure no existing assignment already present (after decline delete)
  const { data: existingAsg } = await db
    .from("journey_assignments")
    .select("id")
    .eq("journey_id", journey_id)
    .eq("vehicle_id", vehicle_id)
    .limit(1);
  if (existingAsg && existingAsg.length > 0) {
    return { ok: true, chosen: null, reason: "already_assigned" as const };
  }

  // insert allocated assignment
  const { data: inserted, error: iErr } = await db
    .from("journey_assignments")
    .insert({
      journey_id,
      vehicle_id,
      staff_id: chosen.staff_id,
      is_lead: true,
      status_simple: "allocated",
      assigned_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (iErr) return { ok: false, reason: "assign_failed" as const };

  // queue email
  const email = staffRows?.find((s) => s.id === chosen.staff_id)?.email || null;
  await db.from("captain_assignment_queue").insert({
    event: "lead_assigned",
    journey_id,
    vehicle_id,
    staff_id: chosen.staff_id,
    staff_email: email,
  });

  // ledger placeholder (unconfirmed win)
  await db.from("captain_fairuse_ledger").insert({
    operator_id,
    vehicle_id,
    journey_id,
    staff_id: chosen.staff_id,
    confirmed: false,
  });

  return { ok: true, chosen: { staff_id: chosen.staff_id, assignment_id: inserted?.id } };
}

/**
 * Body: { assignmentId: string, reason?: string }
 * Side effects:
 *  - checks logged-in crew owns the assignment
 *  - logs captain_journey_events ('declined', note=reason)
 *  - deletes the assignment row (freeing the slot)
 *  - runs auto-assign selector to allocate next lead (if any), enqueues email
 */
export async function POST(req: NextRequest) {
  try {
    const { assignmentId, reason } = (await req.json()) as { assignmentId?: string; reason?: string };
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId required" }, { status: 400 });
    }

    // auth
    const supa = await authClient();
    const { data: ures } = await supa.auth.getUser();
    const authUserId = ures?.user?.id;
    if (!authUserId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // load assignment
    const { data: asg, error: aErr } = await db
      .from("journey_assignments")
      .select("id, journey_id, vehicle_id, staff_id")
      .eq("id", assignmentId)
      .maybeSingle();
    if (aErr || !asg) {
      return NextResponse.json({ error: aErr?.message || "Assignment not found" }, { status: 404 });
    }

    // map staff -> user
    const { data: staffRow, error: sErr } = await db
      .from("operator_staff")
      .select("id, user_id, operator_id")
      .eq("id", (asg as any).staff_id)
      .maybeSingle();
    if (sErr || !staffRow) {
      return NextResponse.json({ error: sErr?.message || "Staff not found" }, { status: 404 });
    }
    if (!staffRow.user_id || staffRow.user_id !== authUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // log declined
    const { error: eErr } = await db.from("captain_journey_events").insert({
      journey_id: (asg as any).journey_id,
      vehicle_id: (asg as any).vehicle_id,
      captain_staff_id: (asg as any).staff_id,
      event_type: "declined",
      note: reason || "Crew declined assignment",
    });
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

    // free the slot
    const { error: dErr } = await db.from("journey_assignments").delete().eq("id", assignmentId);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 400 });

    // reassign next eligible lead
    const result = await autoAssignNextLead({
      operator_id: staffRow.operator_id,
      journey_id: (asg as any).journey_id,
      vehicle_id: (asg as any).vehicle_id,
    });

    return NextResponse.json({ ok: true, reassigned: result.ok, detail: result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad Request" }, { status: 400 });
  }
}
