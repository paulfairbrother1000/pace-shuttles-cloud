// /app/api/_debug/users-exists/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service key bypasses RLS
);

export async function GET() {
  const targetId = "72d8df6e-45c3-494b-bbc8-f1dea00761a6";

  // HEAD count query: cheap existence test
  const { count, error } = await supabase
    .from("users") // <-- IMPORTANT: no "public." prefix here
    .select("*", { count: "exact", head: true })
    .eq("id", targetId);

  return NextResponse.json({ count, error });
}

export {};
