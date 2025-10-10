// src/app/api/ops/captain-candidates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function sbFromCookies() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n) => jar.get(n)?.value,
        set: (n, v, o) => { try { jar.set({ name: n, value: v, ...o }); } catch {} },
        remove: (n, o) => { try { jar.set({ name: n, value: "", ...o }); } catch {} },
      },
    }
  );
}

/**
 * GET /api/ops/captain-candidates?operator_id=...&departure_ts=ISO
 * Returns active operator_staff (preferring jobrole~'captain') with a fair-use score and level.
 */
export async function GET(req: NextRequest) {
  const sb = sbFromCookies();
  const { searchParams } = new URL(req.url);
  const operator_id = (searchParams.get("operator_id") || "").trim();
  const departure_ts = (searchParams.get("departure_ts") || "").trim();

  if (!operator_id) {
    return NextResponse.json({ error: "operator_id required" }, { status: 400 });
  }

  // 1) Staff list
  const { data: staffRows, error: staffErr } = await sb
    .from("operator_staff")
    .select("id, operator_id, active, jobrole, first_name, last_name, photo_url, user_id")
    .eq("operator_id", operator_id)
    .eq("active", true);

  if (staffErr) return NextResponse.json({ error: staffErr.message }, { status: 500 });

  const all = (staffRows ?? []).map((s) => ({
    ...s,
    name: `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim(),
    isCaptainRole: (s.jobrole || "").toLowerCase().includes("captain"),
  }));

  // Prefer captains first, then others
  const pool = [...all.filter(s => s.isCaptainRole), ...all.filter(s => !s.isCaptainRole)];
  if (!pool.length) return NextResponse.json({ candidates: [] });

  // 2) Recent (rolling 30d) and last-20 lifetime leads
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: rErr } = await sb
    .from("journey_assignments")
    .select("staff_id, assigned_at")
    .eq("is_lead", true)
    .gte("assigned_at", since30);

  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const count30 = new Map<string, number>();
  (recent ?? []).forEach((r: any) => count30.set(r.staff_id, (count30.get(r.staff_id) || 0) + 1));

  const { data: lifetime, error: lErr } = await sb
    .from("journey_assignments")
    .select("staff_id, assigned_at")
    .eq("is_lead", true)
    .order("assigned_at", { ascending: false })
    .limit(2000);

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  const last20 = new Map<string, number>();
  if (lifetime?.length) {
    const byStaff = new Map<string, any[]>();
    for (const row of lifetime) {
      const arr = byStaff.get(row.staff_id) || [];
      arr.push(row);
      byStaff.set(row.staff_id, arr);
    }
    for (const [sid, arr] of byStaff.entries()) {
      last20.set(sid, Math.min(arr.length, 20));
    }
  }

  function scoreFor(sid: string) {
    // Weighted: recent assignments are "heavier"
    return (count30.get(sid) || 0) * 2 + (last20.get(sid) || 0);
  }
  function levelFor(score: number): "low" | "medium" | "high" {
    if (score <= 2) return "low";       // fair to allocate more
    if (score <= 6) return "medium";    // okay
    return "high";                      // try to allocate others first
    // Tune thresholds later if needed.
  }

  const candidates = pool
    .map((s) => {
      const score = scoreFor(s.id);
      const level = levelFor(score);
      return {
        staff_id: s.id,
        first_name: s.first_name,
        last_name: s.last_name,
        name: s.name,
        jobrole: s.jobrole,
        photo_url: s.photo_url,
        user_id: s.user_id,
        fairuse_score: score,
        fairuse_level: level,
        is_captain_role: s.isCaptainRole,
      };
    })
    .sort((a, b) => a.fairuse_score - b.fairuse_score);

  return NextResponse.json({ candidates });
}
