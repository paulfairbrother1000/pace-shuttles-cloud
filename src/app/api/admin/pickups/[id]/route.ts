import { NextRequest, NextResponse } from "next/server";

type Params = { id: string };

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  // ...existing logic...
  return NextResponse.json({ ok: true, id, methods: ["GET","POST"] });
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  // ...existing logic...
  return NextResponse.json({ ok: true, id });
}

export {};
