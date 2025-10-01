import { NextResponse } from "next/server";

export async function GET() {
  // Opening the URL in a browser should return this JSON (no 405)
  return NextResponse.json({ ok: true, message: "Use POST to confirm allocations." });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  return NextResponse.json(
    { ok: true, message: "Stub: allocation snapshot accepted.", received: body },
    { status: 200 }
  );
}

export async function OPTIONS() {
  // Helpful if any client sends a preflight
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
