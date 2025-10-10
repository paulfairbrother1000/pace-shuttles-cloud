// src/app/api/operator/assign/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Deprecated. Use /api/ops/assign/lead instead." },
    { status: 410 }
  );
}
