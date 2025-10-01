// src/app/api/me-operator/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function ok(data: any) {
  return NextResponse.json(data, { status: 200 });
}
function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/**
 * POST { id: string }  // users.id (uuid)
 * Returns:
 * {
 *   user: { id, first_name, operator_id, ... },
 *   operator: { id, name, logo_url } | null
 * }
 */
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  if (!id) return bad("Missing id");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // server-side read across tables
  );

  // 1) Fetch the user (authoritative flags + operator_id)
  const { data: u, error: uerr } = await supabase
    .from("users")
    .select(
      "id, first_name, last_name, email, mobile, country_code, site_admin, operator_admin, operator_id"
    )
    .eq("id", id)
    .single();

  if (uerr || !u) return bad("User not found", 404);

  // 2) If the user has an operator_id, fetch the operator row
  let operator: { id: string; name: string | null; logo_url: string | null } | null = null;

  if (u.operator_id) {
    const { data: op, error: operr } = await supabase
      .from("operators")
      .select("id, name, logo_url")
      .eq("id", u.operator_id)
      .single();

    if (!operr && op) {
      operator = {
        id: op.id,
        name: op.name ?? null,
        logo_url: op.logo_url ?? null,
      };
    }
  }

  return ok({
    user: {
      ...u,
      // normalize booleans to strict boolean values
      site_admin:
        typeof u.site_admin === "boolean"
          ? u.site_admin
          : String(u.site_admin ?? "")
              .trim()
              .toLowerCase() === "true" || u.site_admin === "t" || u.site_admin === 1,
      operator_admin:
        typeof u.operator_admin === "boolean"
          ? u.operator_admin
          : String(u.operator_admin ?? "")
              .trim()
              .toLowerCase() === "true" || u.operator_admin === "t" || u.operator_admin === 1,
    },
    operator, // may be null if user has no operator_id
  });
}
