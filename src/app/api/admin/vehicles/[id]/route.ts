import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED = [
  "name",
  "active",
  "minseats",
  "maxseats",
  "minvalue",
  "description",
  "picture_url",
  "min_val_threshold",
  "type_id",
  "operator_id",
];

type Params = { id: string };

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const rec: Record<string, any> = {};
  for (const k of ALLOWED) if (k in body) rec[k] = body[k];
  Object.keys(rec).forEach((k) => rec[k] === undefined && delete rec[k]);

  if (Object.keys(rec).length === 0) return NextResponse.json({ ok: true });

  const { error } = await sb.from("vehicles").update(rec).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const { error } = await sb.from("vehicles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
