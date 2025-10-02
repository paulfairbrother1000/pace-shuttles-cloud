// src/app/api/admin/pickups/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    }
    const sb = createClient(url, service, { auth: { persistSession: false } });

    const body = await req.json().catch(() => ({}));
    const {
      name,
      country_id,
      transport_type_id,
      transport_type_place_id,
      description,
      address1,
      address2,
      town,
      region,
      postal_code,
      picture_url,
    } = body ?? {};

    if (!name || !country_id || !transport_type_id) {
      return NextResponse.json(
        { error: "name, country_id and transport_type_id are required" },
        { status: 400 }
      );
    }

    const { data, error } = await sb
      .from("pickup_points")
      .insert([
        {
          name: String(name).trim(),
          country_id,
          transport_type_id,
          transport_type_place_id: transport_type_place_id || null,
          description: (description ?? "")?.trim() || null,
          address1: (address1 ?? "")?.trim() || null,
          address2: (address2 ?? "")?.trim() || null,
          town: (town ?? "")?.trim() || null,
          region: (region ?? "")?.trim() || null,
          postal_code: (postal_code ?? "")?.trim() || null,
          picture_url: picture_url || null,
        },
      ])
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export {};
