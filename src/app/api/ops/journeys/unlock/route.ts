// src/app/api/ops/journeys/unlock/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function sbAdmin() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Missing Supabase envs");
  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const { journey_id } = await req.json();
    if (!journey_id) {
      return NextResponse.json({ error: "journey_id is required" }, { status: 400 });
    }

    const sb = sbAdmin();

    // 1) clear persisted allocations for this journey
    const del = await sb
      .from("journey_vehicle_allocations")
      .delete()
      .eq("journey_id", journey_id);

    if (del.error) {
      return NextResponse.json({ error: del.error.message }, { status: 500 });
    }

    // 2) mark unlocked (adjust to your schema/flag)
    const upd = await sb
      .from("journeys")
      .update({ is_locked: false })
      .eq("id", journey_id);

    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
