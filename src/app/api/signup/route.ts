import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Basic validators (mirror client)
function isValidEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = String(email).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function validatePassword(pw?: string) {
  const errors: string[] = [];
  if (!pw) errors.push("Password is required.");
  else {
    if (pw.length < 8) errors.push("Must be at least 8 characters.");
    if (pw.length > 64) errors.push("Must be at most 64 characters.");
    if (pw.trim() !== pw) errors.push("No leading or trailing spaces.");
    const hasLower = /[a-z]/.test(pw);
    const hasUpper = /[A-Z]/.test(pw);
    const hasDigit = /\d/.test(pw);
    const hasSymbol = /[^A-Za-z0-9]/.test(pw);
    if ([hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length < 3) {
      errors.push("Include at least three of: lowercase, uppercase, number, symbol.");
    }
  }
  return { ok: errors.length === 0, errors };
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  const b = (await req.json()) as {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    country_code: number | null; // int dial code only
    mobile: number | null;
    password: string;
  };

  // Identity checks
  if (!b.email && !b.mobile) return bad("Provide an email or a mobile number.");
  if (b.email && !isValidEmail(b.email)) return bad("Invalid email format.");

  const pw = validatePassword(b.password);
  if (!pw.ok) return bad(pw.errors.join(" "), 400);

  // If either mobile or dial code present, require both
  const hasMobile = typeof b.mobile === "number";
  const hasCode = typeof b.country_code === "number";
  if (hasMobile !== hasCode) return bad("Provide both dial code and mobile number.");

  // Supabase (server key – not the anon key)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Uniqueness checks
  if (b.email) {
    const { data: e } = await supabase
      .from("users")
      .select("id")
      .eq("email", b.email)
      .maybeSingle();
    if (e) return bad("Email already in use.", 409);
  }
  if (hasMobile && hasCode) {
    const { data: m } = await supabase
      .from("users")
      .select("id")
      .eq("country_code", b.country_code)
      .eq("mobile", b.mobile)
      .maybeSingle();
    if (m) return bad("Mobile already in use.", 409);
  }

  // Insert (password plain text to match current schema)
  const insertPayload = {
    first_name: b.first_name ?? null,
    last_name: b.last_name ?? null,
    email: b.email ?? null,
    country_code: hasCode ? b.country_code : null,
    mobile: hasMobile ? b.mobile : null,
    password: b.password,
    site_admin: null,
    operator_admin: null,
    operator_id: null,
  };

  const { data, error } = await supabase
    .from("users")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

// Optional: tiny GET to sanity-check the route exists
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/signup" });
}

export {};
