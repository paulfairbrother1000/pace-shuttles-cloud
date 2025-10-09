export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// swallow the old beacon; do nothing
export async function POST() {
  return new NextResponse(null, { status: 204 });
}

// optional CORS preflight/no-op
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
