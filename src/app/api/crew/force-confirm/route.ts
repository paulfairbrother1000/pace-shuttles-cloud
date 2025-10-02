// src/app/api/crew/force-confirm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const { assignmentId } = await req.json().catch(() => ({}));
  if (!assignmentId) return NextResponse.json({ error: "Missing assignmentId" }, { status: 400 });

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => cookieStore.get(n)?.value,
        set: (n: string, v: string, o: any) => { try { cookieStore.set({ name: n, value: v, ...o }); } catch {} },
        remove: (n: string, o: any) => { try { cookieStore.set({ name: n, value: "", ...o }); } catch {} },
      },
    }
  );

  const { data: a, error } = await supabase
    .from("journey_assignments")
    .select("id, journey_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error || !a) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

  const { error: upErr } = await supabase
    .from("journey_assignments")
    .update({ status_simple: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, journey_id: a.journey_id });
}

export {};
