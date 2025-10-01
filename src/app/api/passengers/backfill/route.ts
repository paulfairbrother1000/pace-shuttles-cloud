// src/app/api/passengers/backfill/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * POST /api/passengers/backfill
 * Body: { hours?: number }  // default 24
 *
 * - Ensures each recent order has a lead passenger (from orders.lead_first_name/lead_last_name).
 * - Adds extra non-lead "Guest —" rows if booking.seats > 1.
 */
export async function POST(req: Request) {
  try {
    const { hours = 24 } = (await req.json().catch(() => ({}))) as { hours?: number };
    const supabase = createClient(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // 1) add missing lead
    const { error: leadErr } = await supabase.rpc("exec_sql", {
      sql: `
        INSERT INTO order_passengers (order_id, first_name, last_name, is_lead)
        SELECT o.id,
               COALESCE(NULLIF(o.lead_first_name, ''), 'Guest'),
               COALESCE(NULLIF(o.lead_last_name,  ''), '—'),
               TRUE
        FROM orders o
        LEFT JOIN order_passengers op
          ON op.order_id = o.id AND op.is_lead = TRUE
        WHERE o.created_at >= now() - interval '${hours} hours'
          AND op.order_id IS NULL;
      `,
    });

    if (leadErr && leadErr.code !== "PGRST204") {
      // If you don't have exec_sql helper, ignore and switch to direct SQL in the SQL editor.
      console.warn("Backfill lead RPC failed; ignore if you don't use exec_sql helper:", leadErr);
    }

    // 2) add extra guests for seats > 1
    const { data: base, error: baseErr } = await supabase
      .from("orders")
      .select("id, booking_id")
      .gte("created_at", new Date(Date.now() - hours * 3600_000).toISOString());

    if (baseErr) throw baseErr;

    let inserted = 0;

    for (const o of base || []) {
      if (!o.booking_id) continue;

      const { data: bk, error: bErr } = await supabase
        .from("bookings")
        .select("seats")
        .eq("id", o.booking_id)
        .maybeSingle();

      if (bErr) throw bErr;
      const seats = Math.max(Number(bk?.seats ?? 1), 1);
      if (seats <= 1) continue;

      const { data: current, error: cErr } = await supabase
        .from("order_passengers")
        .select("id,is_lead")
        .eq("order_id", o.id);

      if (cErr) throw cErr;
      const have = (current || []).length;
      const target = seats; // 1 lead + (seats-1) others
      const need = Math.max(target - have, 0);
      if (need === 0) continue;

      // insert placeholders
      const rows = Array.from({ length: need }, () => ({
        order_id: o.id,
        first_name: "Guest",
        last_name: "—",
        is_lead: false,
      }));

      const { error: insErr } = await supabase.from("order_passengers").insert(rows);
      if (insErr) throw insErr;
      inserted += rows.length;
    }

    return NextResponse.json({ ok: true, inserted }, { status: 200 });
  } catch (e: any) {
    console.error("[passengers.backfill] error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
