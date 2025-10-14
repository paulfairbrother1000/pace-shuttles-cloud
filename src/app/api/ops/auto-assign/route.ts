// /src/app/api/ops/auto-assign/route.ts
import { NextRequest, NextResponse } from "next/server";

type UUID = string;

function resolveOrigin(req: NextRequest) {
  // primary: request origin (works for dev & prod)
  if (req?.nextUrl?.origin && req.nextUrl.origin.startsWith("http")) {
    return req.nextUrl.origin;
  }
  // vercel env fallback
  const vercel = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : null;
  // app-configured fallbacks
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    null;

  return vercel || site || "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const journeyId: UUID | undefined = body?.journeyId;
    const vehicleId: UUID | undefined = body?.vehicleId;

    if (!journeyId) {
      return NextResponse.json({ error: "journeyId required" }, { status: 400 });
    }
    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId required" }, { status: 400 });
    }

    const origin = resolveOrigin(req);
    const url = `${origin}/api/ops/allocator`;

    // Forward to the allocator route with the expected payload.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // If your allocator expects an action flag, keep it here; otherwise it can be removed.
      body: JSON.stringify({ action: "assign_captain", journeyId, vehicleId }),
      // Important on Vercel: don’t reuse request headers blindly; set only what you need.
    });

    const text = await res.text(); // allocator may or may not return JSON
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return NextResponse.json(data ?? {}, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "auto-assign failed" },
      { status: 500 }
    );
  }
}
