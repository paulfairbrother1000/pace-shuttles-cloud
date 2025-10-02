import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Params = { id: string };

const ALLOWED = [
  "name",
  "slug",
  "description",
  "is_active",
  "sort_order",
  "picture_url",
] as const;

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({} as Record<string, any>));

  const rec: Record<string, any> = {};
  for (const k of ALLOWED) if (k in body) rec[k] = body[k];

  if (typeof rec.slug === "string") {
    rec.slug = slugify(rec.slug);
  }

  if (Object.keys(rec).length === 0) {
    return NextResponse.json({ ok: true, note: "no-op" });
  }

  const { error } = await sb.from("transport_types").update(rec).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  const { error } = await sb.from("transport_types").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export {};
