import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_TNC_VERSION = process.env.CLIENT_TNC_VERSION || "2025-10-10";

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Supabase env not configured" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const quoteToken: string | undefined = body?.quoteToken || body?.token;
    const tncVersion: string =
      String(body?.tncVersion || DEFAULT_TNC_VERSION);

    if (!quoteToken) {
      return NextResponse.json(
        { error: "quoteToken required" },
        { status: 400 }
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Minimal row — do NOT reference columns that may not exist
    const row = {
      quote_token: quoteToken,
      tnc_type: "client",
      tnc_version: tncVersion,
      // deliberately not writing accepted_at/created_by/etc.
    };

    // Try UPSERT on a natural key. If the unique constraint doesn't exist,
    // we'll fall back to a plain INSERT and ignore duplicate key errors.
    let { data, error } = await admin
      .from("order_consents")
      .upsert(row, {
        onConflict: "quote_token,tnc_type,tnc_version",
        ignoreDuplicates: false,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // Fallback: INSERT and ignore dup key (23505) if it already exists
      const ins = await admin
        .from("order_consents")
        .insert(row)
        .select("id")
        .maybeSingle();

      if (ins.error && ins.error.code !== "23505") {
        throw ins.error;
      }
      data = ins.data ?? data;
    }

    return NextResponse.json({
      ok: true,
      id: data?.id ?? null,
      tncVersion,
    });
  } catch (e: any) {
    console.error("[consent/client-tnc] error", e?.message || e);
    return NextResponse.json(
      { error: e?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
