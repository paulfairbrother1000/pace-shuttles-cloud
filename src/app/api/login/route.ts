// src/app/api/login/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
function ok(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

type Body =
  | { mode: "email"; email?: string; password?: string }
  | { mode: "mobile"; country_code?: number; mobile?: string; password?: string };

const PROJECTION =
  "id,first_name,last_name,email,mobile,country_code,password,site_admin,operator_admin,operator_id";

const normBool = (v: any) =>
  typeof v === "boolean"
    ? v
    : typeof v === "number"
    ? v !== 0
    : typeof v === "string"
    ? ["true", "t", "1", "yes", "y", "on"].includes(v.trim().toLowerCase())
    : false;

function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) return bad("Server not configured", 500);

  const admin = createClient(url, serviceKey);

  // 1) Find the user by email OR by (country_code, mobile)
  let q;
  if (body.mode === "email") {
    if (!body.email) return bad("Email required");
    if (!isValidEmail(body.email)) return bad("Invalid email format");
    if (!body.password) return bad("Password required");
    q = admin.from("users").select(PROJECTION).eq("email", body.email.trim()).single();
  } else if (body.mode === "mobile") {
    if (typeof body.country_code !== "number" || !body.mobile) return bad("Dial code and mobile required");
    if (!body.password) return bad("Password required");
    const digits = String(body.mobile).replace(/\D+/g, "");
    q = admin
      .from("users")
      .select(PROJECTION)
      .eq("country_code", body.country_code)
      .eq("mobile", Number(digits))
      .single();
  } else {
    return bad("Invalid mode");
  }

  const { data: user, error } = await q;

  // LOG the exact projection + row we got (visible in server logs)
  console.log("[LOGIN] projection:", PROJECTION);
  console.log("[LOGIN] user row:", user, "error:", error);

  if (error || !user) return bad("Invalid credentials", 401);
  if (String(user.password ?? "") !== String((body as any).password ?? "")) {
    return bad("Invalid credentials", 401);
  }

  // 2) If operator_id is present, fetch operator info
  const operator_id: string | null = user.operator_id ? String(user.operator_id) : null;
  let operator_name: string | null = null;
  let operator_logo_url: string | null = null;

  if (operator_id) {
    const { data: op, error: opErr } = await admin
      .from("operators")
      .select("id,name,logo_url")
      .eq("id", operator_id)
      .single();
    if (!opErr && op) {
      operator_name = op.name ?? null;
      operator_logo_url = op.logo_url ?? null;
    }
  }

  // 3) Return user payload (includes operator_admin and operator_id)
  return ok({
    ok: true,
    redirectTo: "/",
    projection: PROJECTION, // included for clarity
    user: {
      id: user.id,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      email: user.email ?? null,
      mobile: user.mobile ?? null,
      country_code: user.country_code ?? null,
      site_admin: normBool(user.site_admin),
      operator_admin: normBool(user.operator_admin), // <— boolean we use
      operator_id,                                   // <— operator_id from same row
      operator_name,                                 // if found
      operator_logo_url,                             // if found
    },
  });
}
