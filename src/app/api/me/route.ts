// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function handleMe(id?: string | null) {
  if (!id) return json({ error: "Missing id" }, 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) {
    console.error("ME API missing env. URL or SERVICE_ROLE_KEY");
    return json({ error: "Server is missing configuration" }, 500);
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, first_name, last_name, email, mobile, country_code, site_admin, operator_admin, operator_id"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("ME API query error:", error);
    return json({ error: "User not found" }, 404);
  }

  const norm = (v: any) =>
    typeof v === "boolean"
      ? v
      : typeof v === "number"
      ? v !== 0
      : typeof v === "string"
      ? ["true", "t", "1", "yes", "y", "on"].includes(v.trim().toLowerCase())
      : false;

  return json({
    id: data.id,
    first_name: data.first_name ?? null,
    last_name: data.last_name ?? null,
    email: data.email ?? null,
    mobile: data.mobile ?? null,
    country_code: data.country_code ?? null,
    site_admin: norm(data.site_admin),
    operator_admin: norm(data.operator_admin),
    operator_id: data.operator_id ?? null,
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    return await handleMe(id);
  } catch (e) {
    console.error("ME API GET fatal:", e);
    return json({ error: "Internal error" }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body?.id as string | undefined;
    return await handleMe(id);
  } catch (e) {
    console.error("ME API POST fatal:", e);
    return json({ error: "Internal error" }, 500);
  }
}
