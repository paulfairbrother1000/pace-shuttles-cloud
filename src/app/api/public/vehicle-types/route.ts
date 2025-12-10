// src/app/api/public/vehicle-types/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the service role key.
 * This route is only executed on the server, so the key is not exposed
 * to the browser. Make sure SUPABASE_SERVICE_ROLE_KEY is set in Vercel.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("transport_types")
      .select("id, name, description")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("vehicle-types: Supabase error:", error);
      return NextResponse.json(
        { rows: [], error: "Failed to load vehicle types" },
        { status: 500 }
      );
    }

    return NextResponse.json({ rows: data ?? [] });
  } catch (err) {
    console.error("vehicle-types: unexpected error:", err);
    return NextResponse.json(
      { rows: [], error: "Unexpected error loading vehicle types" },
      { status: 500 }
    );
  }
}
