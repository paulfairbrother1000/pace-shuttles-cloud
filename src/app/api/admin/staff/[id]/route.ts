import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

export async function OPTIONS(_req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ ok: true, where: "/api/admin/staff/[id]", method: "OPTIONS" });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, any>));

  if (body.operator_id && body.type_id) {
    const { data: allowed } = await db
      .from("operator_transport_types")
      .select("journey_type_id")
      .eq("operator_id", body.operator_id)
      .eq("journey_type_id", body.type_id)
      .maybeSingle();
    if (!allowed) {
      return NextResponse.json({ error: "Transport type not allowed for this operator" }, { status: 403 });
    }
  }

  const keys = ["operator_id","type_id","jobrole","first_name","last_name","status","licenses","notes","photo_url"];
  const rec: Record<string, any> = {};
  for (const k of keys) if (k in body) rec[k] = body[k];
  if (!Object.keys(rec).length) return NextResponse.json({ ok: true });

  const { error } = await db.from("operator_staff").update(rec).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { error } = await db.from("operator_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export {};
