import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

function idFromReq(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/");
  return parts[parts.length - 1]!;
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const id = idFromReq(req);
  const body = await req.json().catch(() => ({} as Record<string, any>));

  const { error } = await db
    .from("operator_staff")
    .update({
      ...( "type_id" in body ? { type_id: body.type_id } : {} ),
      ...( "jobrole" in body ? { jobrole: body.jobrole } : {} ),
      ...( "first_name" in body ? { first_name: body.first_name } : {} ),
      ...( "last_name" in body ? { last_name: body.last_name } : {} ),
      ...( "status" in body ? { status: body.status } : {} ),
      ...( "licenses" in body ? { licenses: body.licenses } : {} ),
      ...( "notes" in body ? { notes: body.notes } : {} ),
      ...( "photo_url" in body ? { photo_url: body.photo_url } : {} ),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = idFromReq(req);
  const { error } = await db.from("operator_staff").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
