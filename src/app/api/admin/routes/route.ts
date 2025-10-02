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

// (Optional) GET /api/admin/routes — handy for debugging
export async function GET() {
  const { data, error } = await sb
    .from("routes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}

// POST /api/admin/routes
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, any>));

  const allowed: Record<string, any> = {};
  for (const k of ALLOWED_FIELDS) if (k in body) allowed[k] = body[k];
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  const { data, error } = await sb
    .from("routes")
    .insert(allowed)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id });
}

export {};
