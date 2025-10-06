// src/app/api/admin/pickups/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";

type Params = { id: string };

// NOTE: in Next 15, ctx.params is NOT a Promise. If TS complains,
// change the signatures to `{ params }: { params: Params }` and remove `await`.

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  // ...existing logic...
  return NextResponse.json({ ok: true, id, methods: ["GET","POST","PATCH"] });
}

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params;
  // ...your existing update logic...
  return NextResponse.json({ ok: true, id });
}

// ✅ Add this so PATCH works (reuses your POST implementation)
export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  return POST(req, ctx);
}

// (optional) keep/delete handler if you need it later
// export async function DELETE(req: NextRequest, ctx: { params: Promise<Params> }) { ... }

export {};
