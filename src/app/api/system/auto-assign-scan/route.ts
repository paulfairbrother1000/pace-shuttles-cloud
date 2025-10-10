// src/app/api/system/auto-assign-scan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function sbServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value } }
  );
}

export async function GET() {
  const sb = sbServer();

  // Find journeys needing auto-assign scan (example filter; adjust as needed)
  const { data: journeys, error } = await sb.rpc("ps_pick_journeys_for_auto_assign");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let scanned = 0;
  for (const j of journeys || []) {
    scanned += 1;
    // … your scanning/assignment logic can live in DB or added here later …
  }

  return NextResponse.json({ ok: true, scanned });
}

export async function POST(req: NextRequest) {
  // optional POST trigger variant, same as GET
  return GET();
}
