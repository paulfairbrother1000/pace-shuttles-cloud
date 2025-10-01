import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: true, id: params.id, methods: ["GET", "PATCH", "DELETE"] });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    const sb = createClient(url, service, { auth: { persistSession: false } });

    const updates = await req.json().catch(() => ({}));

    const { data: existing, error: readErr } = await sb.from("routes").select("*").eq("id", params.id).single();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const newPickupId  = updates?.pickup_id ?? existing.pickup_id;
    const newDestId    = updates?.destination_id ?? existing.destination_id;
    const newCountryId = updates?.country_id ?? existing.country_id;

    let routeName: string | null = existing.route_name || existing.name || null;
    if (newPickupId !== existing.pickup_id || newDestId !== existing.destination_id || !routeName) {
      const [{ data: p }, { data: d }] = await Promise.all([
        sb.from("pickup_points").select("name").eq("id", newPickupId).single(),
        sb.from("destinations").select("name").eq("id", newDestId).single(),
      ]);
      routeName = p?.name && d?.name ? `${p.name} → ${d.name}` : routeName;
    }

    let countryLabel: string | null | undefined = undefined;
    if (newCountryId !== existing.country_id) {
      const { data: c } = await sb.from("countries").select("name").eq("id", newCountryId).maybeSingle();
      countryLabel = c?.name ?? null;
    }

    const allowed: Record<string, any> = {
      country_id: newCountryId,
      pickup_id: newPickupId,
      destination_id: newDestId,
      name: routeName,
      route_name: routeName,
      approx_duration_mins: updates?.approx_duration_mins,
      approximate_distance_miles: updates?.approximate_distance_miles,
      base_price_gbp: updates?.base_price_gbp,
      pickup_time: updates?.pickup_time,
      frequency: updates?.frequency,
      is_active: typeof updates?.is_active === "boolean" ? updates.is_active : undefined,
    };
    if (countryLabel !== undefined) allowed.country = countryLabel;
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

    const { error } = await sb.from("routes").update(allowed).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    const sb = createClient(url, service, { auth: { persistSession: false } });

    // Guard if referenced by journeys
    const { count, error: refErr } = await sb
      .from("journeys")
      .select("id", { head: true, count: "exact" })
      .eq("route_id", params.id);
    if (!refErr && (count ?? 0) > 0) {
      return NextResponse.json({ error: `Route is used by ${count} journey(s)` }, { status: 409 });
    }

    const { error } = await sb.from("routes").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
