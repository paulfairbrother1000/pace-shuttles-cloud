import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * POST /api/ops/unassign
 * {
 *   kind: "lead" | "crew",
 *   journey_id: UUID,
 *   vehicle_id: UUID,
 *   staff_id: UUID
 * }
 */
export async function POST(req: NextRequest) {
  const cookieJar = cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieJar.get(n)?.value } }
  );

  const body = await req.json().catch(() => ({}));
  const kind = (body?.kind || "").trim();
  const journey_id = (body?.journey_id || "").trim();
  const vehicle_id = (body?.vehicle_id || "").trim();
  const staff_id = (body?.staff_id || "").trim();

  if (!["lead", "crew"].includes(kind) || !journey_id || !vehicle_id || !staff_id) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (kind === "lead") {
    const { error } = await sb
      .from("journey_assignments")
      .delete()
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("staff_id", staff_id)
      .eq("is_lead", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await sb
      .from("journey_crew_assignments")
      .delete()
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("staff_id", staff_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
