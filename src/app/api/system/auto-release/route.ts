// src/app/api/system/auto-release/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sendEmail } from "@/lib/mailer";

type UUID = string;

const GRACE_HOURS = Number(process.env.AUTO_RELEASE_GRACE_HOURS || 6);
const NOTIFY_OP = (process.env.AUTO_RELEASE_NOTIFY ?? "true").toLowerCase() !== "false";

function sb() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => jar.get(n)?.value, set: () => {}, remove: () => {} } }
  );
}

function nowIso() { return new Date().toISOString(); }
function hoursFrom(t0: Date, t1: Date) { return (t1.getTime() - t0.getTime()) / 36e5; }

export async function POST(_req: NextRequest) {
  const client = sb();
  try {
    const now = new Date();

    // Candidates: assigned lead assignments older than GRACE_HOURS, journeys >72h away
    const { data: rows, error } = await client
      .from("journey_assignments")
      .select(`
        id, journey_id, vehicle_id, staff_id, is_lead, status, assigned_at,
        journeys!inner(id, operator_id, route_id, departure_ts, is_active),
        vehicles!inner(id, name),
        routes!inner(id, route_name, name)
      `)
      .eq("is_lead", true)
      .eq("status", "assigned");

    if (error) throw error;

    let released = 0;

    for (const r of rows ?? []) {
      const ja = (r as any).journeys;
      if (!ja?.is_active) continue;

      const dep = new Date(ja.departure_ts);
      const horizonHrs = (dep.getTime() - now.getTime()) / 36e5;
      if (horizonHrs <= 72) continue; // only > T-72

      const assignedAt = r.assigned_at ? new Date(r.assigned_at) : null;
      if (!assignedAt) continue;
      if (hoursFrom(assignedAt, now) < GRACE_HOURS) continue;

      // Pax == 0 check on (journey, vehicle)
      const { data: paxRows, error: paxErr } = await client
        .from("journey_vehicle_allocations")
        .select("seats")
        .eq("journey_id", r.journey_id)
        .eq("vehicle_id", r.vehicle_id);

      if (paxErr) continue;
      const paxTotal = (paxRows || []).reduce((s: number, rr: any) => s + Number(rr.seats || 0), 0);
      if (paxTotal > 0) continue;

      // Auto-release: set status back to 'released' (or delete if you prefer)
      const { error: upErr } = await client
        .from("journey_assignments")
        .update({ status: "released", status_simple: "allocated", confirmed_at: null })
        .eq("id", r.id);
      if (upErr) continue;

      released++;

      // Notify operator once per release
      if (NOTIFY_OP) {
        const { data: op } = await client
          .from("operators")
          .select("admin_email")
          .eq("id", ja.operator_id)
          .maybeSingle();

        if (op?.admin_email) {
          const routeName = (r as any).routes?.route_name || (r as any).routes?.name || "Journey";
          const vehName = (r as any).vehicles?.name || "Vehicle";
          const dateStr = new Date(ja.departure_ts).toLocaleDateString();

          const html = `
            <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
              <p><strong>Lead auto-released</strong></p>
              <p>The lead assignment for <strong>${routeName}</strong> (${vehName}) on <strong>${dateStr}</strong> was auto-released.</p>
              <p>Reason: ${GRACE_HOURS} hours elapsed with zero passengers (&gt; T-72).</p>
            </div>
          `;
          await sendEmail({
            to: op.admin_email,
            subject: `Lead auto-released — ${routeName} (${dateStr})`,
            html
          });
        }
      }
    }

    return NextResponse.json({ ok: true, released });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

// GET wrapper for Vercel Cron
export async function GET(req: NextRequest) {
  // @ts-ignore
  return POST(req);
}
