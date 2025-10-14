// src/app/api/ops/captain-candidates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { journeyId } = await req.json();
    if (!journeyId) return NextResponse.json({ error: "journeyId required" }, { status: 400 });

    const { data: j } = await sb.from("journeys").select("id, vehicle_id, operator_id, departure_ts").eq("id", journeyId).single();
    if (!j?.vehicle_id || !j?.operator_id) return NextResponse.json({ items: [] });

    const { data: prefs } = await sb
      .from("vehicle_staff_prefs")
      .select("staff_id, priority, is_lead_eligible")
      .eq("vehicle_id", j.vehicle_id)
      .eq("operator_id", j.operator_id);

    const base = (prefs ?? [])
      .filter((p: any) => p.is_lead_eligible !== false)
      .map((p: any) => ({ staff_id: p.staff_id as string, priority: p.priority as number }));

    // fallback to operator captains if prefs empty
    let pool = base;
    if (pool.length === 0) {
      const { data: caps } = await sb
        .from("operator_staff")
        .select("id, jobrole")
        .eq("operator_id", j.operator_id)
        .eq("active", true);
      pool = (caps ?? [])
        .filter((c: any) => String(c.jobrole || "").toLowerCase().includes("capt"))
        .map((c: any) => ({ staff_id: c.id as string, priority: 3 }));
    }

    // names
    const ids = pool.map((p) => p.staff_id);
    const { data: staff } = await sb
      .from("operator_staff")
      .select("id, first_name, last_name, email")
      .in("id", ids);

    // fair-use
    const { data: ledger } = await sb
      .from("captain_fairuse_ledger")
      .select("staff_id")
      .eq("operator_id", j.operator_id);
    const counts = new Map<string, number>();
    (ledger ?? []).forEach((r: any) => counts.set(r.staff_id, (counts.get(r.staff_id) ?? 0) + 1));

    const items = pool
      .map((p) => {
        const s = (staff ?? []).find((x: any) => x.id === p.staff_id);
        const name = [s?.first_name, s?.last_name].filter(Boolean).join(" ") || "—";
        return { staff_id: p.staff_id, name, email: s?.email ?? null, priority: p.priority, recent: counts.get(p.staff_id) ?? 0 };
      })
      .sort((a, b) => (a.priority - b.priority) || (a.recent - b.recent) || a.name.localeCompare(b.name));

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
