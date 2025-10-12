import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

// UPDATE staff — pronoun allowed
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({} as Record<string, any>));
  const allowed = [
    "operator_id","type_id","type_ids","jobrole","pronoun",
    "first_name","last_name","email","status","licenses","notes","photo_url",
  ];
  const update: Record<string, any> = {};
  for (const k of allowed) if (k in b) update[k] = b[k];

  const { error } = await db.from("operator_staff").update(update).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// DELETE staff
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error } = await db.from("operator_staff").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export function OPTIONS() {
  return NextResponse.json({ ok: true });
}
