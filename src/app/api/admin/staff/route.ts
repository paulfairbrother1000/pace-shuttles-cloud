import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

// Healthcheck (lets you open /api/admin/staff in a browser)
export async function GET(_req: NextRequest, _ctx: { params: Promise<{}> }) {
  return NextResponse.json({ ok: true, where: "/api/admin/staff", method: "GET" });
}

// CORS / probe
export async function OPTIONS(_req: NextRequest, _ctx: { params: Promise<{}> }) {
  return NextResponse.json({ ok: true, where: "/api/admin/staff", method: "OPTIONS" });
}

export async function POST(req: NextRequest, _ctx: { params: Promise<{}> }) {
  const body = await req.json().catch(() => ({} as Record<string, any>));

  // required fields
  for (const k of ["operator_id", "type_id", "first_name", "last_name"]) {
    if (!body[k]) return NextResponse.json({ error: `${k} required` }, { status: 400 });
  }

  // ensure type is allowed for operator
  const { data: allowed } = await db
    .from("operator_transport_types")
    .select("journey_type_id")
    .eq("operator_id", body.operator_id)
    .eq("journey_type_id", body.type_id)
    .maybeSingle();
  if (!allowed) {
    return NextResponse.json({ error: "Transport type not allowed for this operator" }, { status: 403 });
  }

  const rec = {
    operator_id: body.operator_id,
    type_id: body.type_id,
    jobrole: body.jobrole ?? null,
    first_name: body.first_name,
    last_name: body.last_name,
    status: body.status ?? "Active",
    licenses: body.licenses ?? null,
    notes: body.notes ?? null,
    photo_url: body.photo_url ?? null,
  };

  const { data, error } = await db.from("operator_staff").insert(rec).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: data?.id });
}
