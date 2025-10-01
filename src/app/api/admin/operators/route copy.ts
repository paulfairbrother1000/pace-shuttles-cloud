import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Allowed columns on create
const OP_ALLOWED = [
  "country_id",
  "name",
  "admin_email",
  "phone",
  "address1",
  "address2",
  "town",
  "region",
  "postal_code",
  "logo_url",
];

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const { data, error } = await sb
    .from("operators")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const journeyTypeIds: string[] = Array.isArray(body.journey_type_ids) ? body.journey_type_ids : [];

  const allowed: Record<string, any> = {};
  for (const k of OP_ALLOWED) if (k in body) allowed[k] = body[k];
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  const { data: op, error } = await sb
    .from("operators")
    .insert(allowed)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (op?.id && journeyTypeIds.length > 0) {
    const rows = journeyTypeIds.map((jt) => ({ operator_id: op.id, journey_type_id: jt }));
    const { error: jtErr } = await sb.from("operator_transport_types").insert(rows);
    if (jtErr) return NextResponse.json({ error: jtErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: op?.id });
}
