import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, methods: ["GET", "POST"] });
}

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
      country_id,
      pickup_id,
      destination_id,
      approx_duration_mins,
      approximate_distance_miles,
      base_price_gbp,
      pickup_time,
      frequency,
      is_active,
    } = body ?? {};

    if (!country_id || !pickup_id || !destination_id) {
      return NextResponse.json({ error: "country_id, pickup_id and destination_id are required" }, { status: 400 });
    }

    // derive route name and country label
    const [{ data: p }, { data: d }, { data: c }] = await Promise.all([
      sb.from("pickup_points").select("name").eq("id", pickup_id).single(),
      sb.from("destinations").select("name").eq("id", destination_id).single(),
      sb.from("countries").select("name").eq("id", country_id).single(),
    ]);
    const routeName = p?.name && d?.name ? `${p.name} → ${d.name}` : null;

    const { data, error } = await sb
      .from("routes")
      .insert([{
        country_id,
        country: c?.name ?? null,
        pickup_id,
        destination_id,
        name: routeName,
        route_name: routeName,
        approx_duration_mins: approx_duration_mins ?? null,
        approximate_distance_miles: approximate_distance_miles ?? null,
        base_price_gbp: base_price_gbp ?? null,
        pickup_time: pickup_time || null,
        frequency: frequency || null,
        is_active: is_active ?? true,
      }])
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
