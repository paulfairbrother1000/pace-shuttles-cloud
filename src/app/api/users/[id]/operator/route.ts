// src/app/api/users/[id]/operator/route.ts
import { NextRequest, NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Params = { id: string };

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  if (!URL || !SERVICE_KEY) {
    return NextResponse.json(
      { error: "Server env not configured" },
      { status: 500 }
    );
  }

  const { id } = await ctx.params;

  try {
    // 1) fetch user (service key bypasses RLS)
    const uRes = await fetch(
      `${URL}/rest/v1/users?select=id,email,first_name,last_name,mobile,country_code,site_admin,operator_admin,operator_id&id=eq.${encodeURIComponent(
        id
      )}&limit=1`,
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

    if (!uRes.ok) {
      const body = await uRes.text();
      return NextResponse.json(
        { error: "users fetch failed", details: body || uRes.statusText },
        { status: 500 }
      );
    }

    const users = (await uRes.json()) as any[];
    const userRow = users[0];

    if (!userRow) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }
    if (!userRow.operator_admin) {
      return NextResponse.json(
        { error: "not an operator admin" },
        { status: 403 }
      );
    }
    if (!userRow.operator_id) {
      return NextResponse.json(
        { user: userRow, operator: null },
        { status: 200 }
      );
    }

    // 2) fetch operator WITH logo_url
    const oRes = await fetch(
      `${URL}/rest/v1/operators?select=id,name,logo_url&id=eq.${userRow.operator_id}&limit=1`,
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

    if (!oRes.ok) {
      const body = await oRes.text();
      return NextResponse.json(
        { error: "operator fetch failed", details: body || oRes.statusText },
        { status: 500 }
      );
    }

    const ops = (await oRes.json()) as any[];
    const operator = ops[0] ?? null;

    // returns { user: {...}, operator: { id, name, logo_url } }
    return NextResponse.json({ user: userRow, operator }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "unexpected error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export {};
