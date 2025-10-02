import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client (service role; keep ONLY on server)
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_FIELDS = [
  "country_id",
  "pickup_id",
  "destination_id",
  "approx_duration_mins",
  "approximate_distance_miles",
  "pickup_time",
  "frequency",
  "frequency_rrule",
  "is_active",
  "route_name",
  "name",

  // Journey type + legacy label text
  "journey_type_id",
  "transport_type",

  // Season window
  "season_from",
  "season_to",

  // Optional discount fields
  "early_booking_days_min",
  "early_discount_percent",
  "late_booking_days_max",
  "late_discount_percent",
];

type Params = { id: string };

// PATCH /api/admin/routes/[id]
export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params; // <-- important in Next 15+
  const body = await req.json().catch(() => ({} as Record<string, any>));

  const allowed: Record<string, any> = {};
  for (const k of ALLOWED_FIELDS) if (k in body) allowed[k] = body[k];
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  const { error } = await sb.from("routes").update(allowed).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/routes/[id]
export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { id } = await ctx.params; // <-- important in Next 15+
  const { error } = await sb.from("routes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export {};
