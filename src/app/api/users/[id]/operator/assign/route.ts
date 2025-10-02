import { NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RouteParams = { params: { id: string } };

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const operator_id = body?.operator_id as string | undefined;
  if (!operator_id) return NextResponse.json({ error: "operator_id is required" }, { status: 400 });

  try {
    // 1) ensure user exists
    const uRes = await fetch(
      `${URL}/rest/v1/users?select=id&id=eq.${id}&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Accept-Profile": "public",
          "Content-Profile": "public",
        },
        cache: "no-store",
      }
    );
    const users = uRes.ok ? await uRes.json() : [];
    if (!uRes.ok || users.length === 0) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    // 2) ensure operator exists
    const oRes = await fetch(
      `${URL}/rest/v1/operators?select=id&id=eq.${operator_id}&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Accept-Profile": "public",
          "Content-Profile": "public",
        },
        cache: "no-store",
      }
    );
    const ops = oRes.ok ? await oRes.json() : [];
    if (!oRes.ok || ops.length === 0) {
      return NextResponse.json({ error: "operator not found" }, { status: 404 });
    }

    // 3) update users.operator_id
    const updRes = await fetch(
      `${URL}/rest/v1/users?id=eq.${id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Accept-Profile": "public",
          "Content-Profile": "public",
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ operator_id }),
      }
    );

    if (!updRes.ok) {
      const body = await updRes.text();
      return NextResponse.json({ error: "update failed", details: body || updRes.statusText }, { status: 500 });
    }

    const updated = await updRes.json();
    return NextResponse.json({ ok: true, operator_id, updated }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
export {};
