import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const CLIENT_TNC_VERSION = process.env.CLIENT_TNC_VERSION || "2025-10-10";

export async function POST(req: NextRequest) {
  try {
    const { quoteToken, tncVersion } = await req.json();
    if (!quoteToken) {
      return NextResponse.json({ error: "Missing quoteToken" }, { status: 400 });
    }
    const version = String(tncVersion || CLIENT_TNC_VERSION);

    const jar = await cookies();
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => jar.set(name, value, options),
        remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
      },
    });

    const { error } = await supabase
      .from("order_consents")
      .upsert(
        {
          quote_token: quoteToken,
          tnc_type: "client",
          tnc_version: version,
          accepted_at: new Date().toISOString(),
        },
        { onConflict: "quote_token,tnc_type,tnc_version" }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid request" }, { status: 400 });
  }
}
