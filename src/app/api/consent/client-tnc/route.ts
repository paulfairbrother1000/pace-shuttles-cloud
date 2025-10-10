// src/app/api/consent/client-tnc/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
// If you already have this from /api/checkout:
import * as QuoteToken from "@/lib/quoteToken";
import type { QuotePayloadV1 } from "@/lib/quoteToken";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { quoteToken, tncVersion } = await req.json();

    if (!quoteToken || !tncVersion) {
      return NextResponse.json({ error: "Missing quoteToken or tncVersion" }, { status: 400 });
    }

    // Verify SSOT token (throws if invalid)
    const payload = QuoteToken.verify<QuotePayloadV1>(quoteToken);

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, { cookies });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.ip ||
      headers().get("x-real-ip") ||
      null;

    const userAgent = req.headers.get("user-agent") || null;

    // Optional: figure out order_id if it already exists in your flow
    const orderId = null;

    const { error } = await supabase.from("order_consents").insert({
      order_id: orderId,
      quote_token: quoteToken,
      user_id: null,              // if you have an auth’d user, add it
      tnc_type: "client",
      tnc_version: tncVersion,
      ip,
      user_agent: userAgent,
      extra: { quote: payload },  // snapshot of the verified quote payload
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Invalid request" }, { status: 400 });
  }
}
