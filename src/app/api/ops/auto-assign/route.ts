// src/app/api/ops/auto-assign/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { journeyId } = await req.json();
    if (!journeyId) return NextResponse.json({ error: "journeyId required" }, { status: 400 });

    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/ops/allocator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ journeyId }),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
