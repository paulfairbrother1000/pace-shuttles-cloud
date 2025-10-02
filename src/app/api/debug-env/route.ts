// src/app/api/debug-env/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const keys = [
    "QUOTE_SIGNING_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE",
  ] as const;

  const out: Record<string, { present: boolean; length: number }> = {};
  for (const k of keys) {
    const v = process.env[k];
    out[k] = { present: !!v, length: v ? v.length : 0 };
  }
  return NextResponse.json(out);
}
