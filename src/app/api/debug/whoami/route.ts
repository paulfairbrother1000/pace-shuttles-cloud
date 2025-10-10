// src/app/api/debug/whoami/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function sb() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => jar.get(n)?.value } }
  );
}

export async function GET() {
  try {
    const supa = sb();
    const { data: ures, error: uerr } = await supa.auth.getUser();
    if (uerr || !ures?.user) {
      return NextResponse.json({ authed: false, error: uerr?.message ?? "No user" }, { status: 200 });
    }

    const uid = ures.user.id;
    const email = (ures.user.email ?? ures.user.user_metadata?.email) as string | undefined;

    const { data: rows } = await supa
      .from("operator_admin_users")
      .select("user_id, operator_id");

    return NextResponse.json({
      authed: true,
      uid,
      email,
      operator_admin_users: (rows || []).filter(r => r.user_id === uid),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "fail" }, { status: 500 });
  }
}
