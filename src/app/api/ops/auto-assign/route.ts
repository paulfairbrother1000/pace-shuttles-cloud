// /src/app/api/ops/auto-assign/route.ts
import { NextRequest, NextResponse } from "next/server";

type UUID = string;

function resolveOrigin(req: NextRequest) {
  // Prefer the request origin (works in dev & prod)
  const fromReq = req?.nextUrl?.origin;
  if (fromReq && fromReq.startsWith("http")) return fromReq;

  // Vercel fallback (no protocol in VERCEL_URL)
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  // App-configured fallbacks
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL;
  return site || "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const journeyId: UUID | undefined = body?.journeyId;

    if (!journeyId) {
      return NextResponse.json({ error: "journeyId required" }, { status: 400 });
    }

    const origin = resolveOrigin(req);
    const url = `${origin}/api/ops/allocator`;

    // Forward to the allocator. It only needs journeyId.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId }),
      // Don’t forward incoming headers blindly; keep it minimal.
    });

    // allocator returns JSON; but be defensive:
    const text = await res.text();
    try {
      const json = text ? JSON.parse(text) : {};
      return NextResponse.json(json, { status: res.status });
    } catch {
      // If allocator ever returned non-JSON, wrap it.
      return NextResponse.json({ raw: text }, { status: res.status });
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "auto-assign failed" },
      { status: 500 }
    );
  }
}
