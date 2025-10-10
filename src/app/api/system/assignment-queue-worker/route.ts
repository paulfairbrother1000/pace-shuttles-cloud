// src/app/api/system/assignment-queue-worker/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { sendEmail } from "@/lib/mailer";

function sb() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => jar.get(n)?.value } }
  );
}

const BATCH = Number(process.env.CAQ_WORKER_BATCH || 25);

export async function POST(_req: NextRequest) {
  const supabase = sb();
  try {
    const { data: queue, error } = await supabase
      .from("captain_assignment_queue")
      .select("*")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (error) throw error;
    if (!queue?.length) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;

    for (const q of queue) {
      // Load context for email
      const [{ data: j }, { data: v }] = await Promise.all([
        supabase
          .from("journeys")
          .select("id, route_id, departure_ts, operator_id")
          .eq("id", q.journey_id)
          .maybeSingle(),
        supabase
          .from("vehicles")
          .select("id, name, operator_id")
          .eq("id", q.vehicle_id)
          .maybeSingle(),
      ]);
      if (!j || !v) continue;

      const { data: route } = await supabase
        .from("routes")
        .select("id, route_name, name")
        .eq("id", j.route_id)
        .maybeSingle();

      const { data: staff } = await supabase
        .from("operator_staff")
        .select("id, first_name, last_name, email")
        .eq("id", q.staff_id)
        .maybeSingle();

      const { data: op } = await supabase
        .from("operators")
        .select("id, name, admin_email")
        .eq("id", j.operator_id ?? v.operator_id)
        .maybeSingle();

      const dep = j?.departure_ts ? new Date(j.departure_ts) : null;
      const journeyName = route?.route_name || route?.name || "Journey";
      const dateStr = dep ? dep.toLocaleDateString() : "—";
      const timeStr = dep ? dep.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
      const captainName = `${staff?.first_name ?? ""} ${staff?.last_name ?? ""}`.trim() || "Captain";
      const vehicleName = v?.name || "Vehicle";

      const toCaptain = (q as any).staff_email || staff?.email || null;
      const toOperator = op?.admin_email || null;

      const htmlCaptain = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
          <p>Hi ${captainName},</p>
          <p>You've been <strong>assigned</strong> as lead for <strong>${journeyName}</strong> on <strong>${dateStr}</strong> at <strong>${timeStr}</strong>.</p>
          <p>Vehicle: <strong>${vehicleName}</strong></p>
          <p>Please visit your Captain/Crew page to <strong>accept or decline</strong>.</p>
          <p>— Pace Shuttles</p>
        </div>
      `;

      const htmlOperator = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
          <p><strong>Lead assigned</strong></p>
          <p>${captainName} assigned to ${journeyName} (${vehicleName}) — ${dateStr} ${timeStr}</p>
        </div>
      `;

      try {
        if (toCaptain) {
          await sendEmail({
            to: toCaptain,
            subject: `Assigned: ${journeyName} — ${dateStr} ${timeStr}`,
            html: htmlCaptain,
          });
        }
        if (toOperator) {
          await sendEmail({
            to: toOperator,
            subject: `Lead assigned — ${journeyName} (${dateStr})`,
            html: htmlOperator,
          });
        }
      } catch {
        // Keep it in the queue to retry next tick
        continue;
      }

      // Mark processed
      await supabase
        .from("captain_assignment_queue")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", q.id);

      processed += 1;
    }

    return NextResponse.json({ ok: true, processed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

// GET wrapper (Vercel Cron)
export async function GET(req: NextRequest) { /* @ts-ignore */ return POST(req); }
