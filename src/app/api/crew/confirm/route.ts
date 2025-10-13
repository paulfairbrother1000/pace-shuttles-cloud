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

/**
 * Body: { assignmentId: string }
 * Side effects:
 *  - checks logged-in crew owns the assignment
 *  - sets journey_assignments.status_simple='confirmed', confirmed_at=now()
 *  - inserts captain_journey_events ('accepted')
 *  - upserts captain_fairuse_ledger (confirmed=true)
 */
export async function POST(req: NextRequest) {
  try {
    const { assignmentId } = (await req.json()) as { assignmentId?: string };
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId required" }, { status: 400 });
    }

    // who is the logged-in user?
    const supa = await authClient();
    const { data: ures } = await supa.auth.getUser();
    const authUserId = ures?.user?.id;
    if (!authUserId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // fetch assignment + owning staff (to validate user)
    const { data: asg, error: aErr } = await db
      .from("journey_assignments")
      .select("id, journey_id, vehicle_id, staff_id, status_simple")
      .eq("id", assignmentId)
      .maybeSingle();
    if (aErr || !asg) {
      return NextResponse.json({ error: aErr?.message || "Assignment not found" }, { status: 404 });
    }

    // get operator_staff.user_id to map to this auth user
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

    // Set confirmed
    const { error: uErr } = await db
      .from("journey_assignments")
      .update({ status_simple: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", assignmentId);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 400 });

    // Log event
    const { error: eErr } = await db.from("captain_journey_events").insert({
      journey_id: (asg as any).journey_id,
      vehicle_id: (asg as any).vehicle_id,
      captain_staff_id: (asg as any).staff_id,
      event_type: "accepted", // enum value per your journey_event_type
      note: "Crew accepted assignment",
    });
    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 400 });

    // Upsert fair-use ledger (mark confirmed = true)
    // (No unique constraint; we "find-or-insert then update" by existence)
    const { data: existing } = await db
      .from("captain_fairuse_ledger")
      .select("id")
      .eq("journey_id", (asg as any).journey_id)
      .eq("vehicle_id", (asg as any).vehicle_id)
      .eq("staff_id", (asg as any).staff_id)
      .limit(1);
    if (!existing || existing.length === 0) {
      await db.from("captain_fairuse_ledger").insert({
        operator_id: staffRow.operator_id,
        vehicle_id: (asg as any).vehicle_id,
        journey_id: (asg as any).journey_id,
        staff_id: (asg as any).staff_id,
        confirmed: true,
      });
    } else {
      await db
        .from("captain_fairuse_ledger")
        .update({ confirmed: true })
        .eq("id", existing[0].id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad Request" }, { status: 400 });
  }
}
