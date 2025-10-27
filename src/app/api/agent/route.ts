// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  return NextResponse.json({ content: `You said: ${message || "(empty)"}` });
}
