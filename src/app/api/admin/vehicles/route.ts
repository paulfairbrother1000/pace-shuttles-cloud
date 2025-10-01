import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role for RLS-protected writes
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
  "type_id",      // journey_types.id (string)
  "operator_id",  // requires column (see SQL below)
];

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { data, error } = await sb.from("vehicles").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const rec: Record<string, any> = {};
  for (const k of ALLOWED) if (k in body) rec[k] = body[k];
  Object.keys(rec).forEach((k) => rec[k] === undefined && delete rec[k]);

  // Basic guards: operator & type required on create
  if (!rec.operator_id) return NextResponse.json({ error: "operator_id required" }, { status: 400 });
  if (!rec.type_id) return NextResponse.json({ error: "type_id required" }, { status: 400 });

  const { data, error } = await sb.from("vehicles").insert(rec).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: data?.id });
}
