// src/app/api/consent/client-tnc/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { quoteToken, tncVersion } = await req.json();

    if (!quoteToken || !tncVersion) {
      return NextResponse.json(
        { ok: false, error: "quoteToken and tncVersion are required" },
        { status: 400 }
      );
    }

    const jar = await cookies();
    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => jar.set(name, value, options),
        remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
      },
    });

    // upsert to avoid duplicates if user clicks twice
    const { error } = await sb
      .from("order_consents")
      .upsert(
        {
          quote_token: String(quoteToken),
          tnc_type: "client",
          tnc_version: String(tncVersion),
        },
        { onConflict: "quote_token,tnc_type,tnc_version", ignoreDuplicates: true }
      );

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Failed to save consent: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Invalid request" },
      { status: 400 }
    );
  }
}
