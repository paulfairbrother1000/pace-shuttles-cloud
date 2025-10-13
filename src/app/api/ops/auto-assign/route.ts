// src/app/api/ops/auto-assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runAutoAssign } from "@/lib/autoAssign";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const scope = {
      all: !!body?.all,
      operator_id: body?.operator_id ?? null,
    } as { all?: boolean; operator_id?: string|null };

    const { changed } = await runAutoAssign(scope);
    return NextResponse.json({ ok: true, changed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Auto-assign failed" }, { status: 500 });
  }
}
