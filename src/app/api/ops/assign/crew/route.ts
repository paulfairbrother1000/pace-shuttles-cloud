// src/app/api/ops/assign/crew/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sendMail } from "@/lib/mailer"; // ✅ named import

export async function POST(req: NextRequest) {
  const { journey_id, vehicle_id, staff_ids } = await req.json().catch(() => ({}));
  if (!journey_id || !vehicle_id || !Array.isArray(staff_ids) || staff_ids.length === 0) {
    return NextResponse.json({ error: "journey_id, vehicle_id and staff_ids[] required" }, { status: 400 });
  }

  const cookieStore = cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value } }
  );

  const { data: ures } = await sb.auth.getUser();
  if (!ures?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // de-dupe and insert only missing crew members
  const toInsert: any[] = [];
  for (const sid of Array.from(new Set(staff_ids))) {
    const { data: exists } = await sb
      .from("journey_assignments")
      .select("id")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("staff_id", sid)
      .limit(1);

    if (!exists || !exists.length) {
      toInsert.push({
        journey_id,
        vehicle_id,
        staff_id: sid,
        role_label: "Crew",
        status_simple: "allocated",
        assigned_at: new Date().toISOString(),
      });
    }
  }

  if (toInsert.length) {
    const { error } = await sb.from("journey_assignments").insert(toInsert);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // optional: email all added crew
  try {
    await sendMail({
      to: [], // fill if you want immediate notifications
      subject: "Crew assignment",
      html: `<p>You have been added as Crew.</p>`,
    });
  } catch {}

  return NextResponse.json({ ok: true, added: toInsert.length });
}
