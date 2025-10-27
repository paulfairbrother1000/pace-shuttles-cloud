import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pickup_id, destination_id, country_id, is_active_only = true, limit = 20 } = body ?? {};

    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get() {}, set() {}, remove() {} } } // no session needed
    );

    let q = sb.from("vw_routes_public").select("*").limit(limit);
    if (pickup_id) q = q.eq("pickup_id", pickup_id);
    if (destination_id) q = q.eq("destination_id", destination_id);
    if (is_active_only) q = q.eq("is_active", true); // harmless if column not present in view

    const { data, error } = await q;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ routes: data ?? [] });
  } catch (e: any) {
    return Response.json({ error: e?.message || "Bad request" }, { status: 400 });
  }
}
