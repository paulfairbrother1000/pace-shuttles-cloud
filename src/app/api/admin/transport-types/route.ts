import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

// Healthcheck
export async function GET(_req: NextRequest, _ctx: { params: Promise<{}> }) {
  return NextResponse.json({ ok: true, where: "/api/admin/transport-types", method: "GET" });
}

// CORS / probe
export async function OPTIONS(_req: NextRequest, _ctx: { params: Promise<{}> }) {
  return NextResponse.json({ ok: true, where: "/api/admin/transport-types", method: "OPTIONS" });
}

// Create
export async function POST(req: NextRequest, _ctx: { params: Promise<{}> }) {
  const body = await req.json().catch(() => ({} as Record<string, any>));
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // slug: client may send one; otherwise derive
  const slug = (body.slug ?? name)
    .toString()
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const rec = {
    name,
    slug: slug || null,
    description: body.description ?? null,
    is_active: typeof body.is_active === "boolean" ? body.is_active : true,
    sort_order: Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0,
    picture_url: body.picture_url ?? null, // usually set after upload via PATCH
  };

  const { data, error } = await db.from("transport_types").insert(rec).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: data?.id });
}

export {};
