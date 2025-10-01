import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

type Params = { id: string };

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const journeyTypeIds: string[] | undefined = Array.isArray(body.journey_type_ids) ? body.journey_type_ids : undefined;

  const allowed: Record<string, any> = {};
  for (const k of OP_ALLOWED) if (k in body) allowed[k] = body[k];
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  if (Object.keys(allowed).length > 0) {
    const { error } = await sb.from("operators").update(allowed).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (journeyTypeIds) {
    const { data: existing, error: exErr } = await sb
      .from("operator_transport_types")
      .select("journey_type_id")
      .eq("operator_id", id);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });

    const current = new Set((existing ?? []).map((r) => r.journey_type_id));
    const next = new Set(journeyTypeIds);

    const toInsert = [...next].filter((x) => !current.has(x)).map((jt) => ({ operator_id: id, journey_type_id: jt }));
    const toDelete = [...current].filter((x) => !next.has(x));

    if (toInsert.length > 0) {
      const { error: insErr } = await sb.from("operator_transport_types").insert(toInsert);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 });
    }
    if (toDelete.length > 0) {
      const { error: delErr } = await sb
        .from("operator_transport_types")
        .delete()
        .eq("operator_id", id)
        .in("journey_type_id", toDelete);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const { error: relErr } = await sb.from("operator_transport_types").delete().eq("operator_id", id);
  if (relErr) return NextResponse.json({ error: relErr.message }, { status: 400 });
  const { error } = await sb.from("operators").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
