// app/api/jobs/maintain/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const isBearerOk = auth === `Bearer ${process.env.CRON_SECRET}`;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (!isBearerOk && !isVercelCron) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // service role for RPC
  );

  const { data, error } = await supabase.rpc("pace.maintain");
  if (error) {
    console.error("[maintain] RPC error", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}
