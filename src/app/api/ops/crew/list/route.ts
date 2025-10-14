// src/app/api/ops/crew/list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Operator dashboard → captain/crew per journey/vehicle
 * GET /api/ops/crew/list?journey_id=<uuid>[&vehicle_id=<uuid>]
 *
 * Source view: v_crew_assignments_min
 * Columns: assignment_id, journey_id, vehicle_id, staff_id,
 *          status_simple, first_name, last_name, role_label
 */

// Ensure Node runtime (service role keys are not allowed on Edge)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function sbAdmin() {
  // Prefer server-only URL; fall back to public URL if needed
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !key) {
    const msg =
      "Supabase env missing. Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY";
    console.error("[crew/list] ENV ERROR:", {
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      has_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    throw new Error(msg);
  }

  // Guard against accidentally passing a Postgres connection URL
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    console.error("[crew/list] Bad SUPABASE_URL value (looks like Postgres conn string).", { urlPrefix: url.slice(0, 24) + "…" });
    throw new Error("SUPABASE_URL must be your project REST URL (https://<ref>.supabase.co), not a postgres:// connection string");
  }

  return createClient(url, key);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(req.url);
    const journey_id = url.searchParams.get("journey_id") || "";
    const vehicle_id = url.searchParams.get("vehicle_id") || "";

    console.log("[crew/list] start", {
      journey_id,
      vehicle_id: vehicle_id || null,
      host: url.host,
      path: url.pathname,
    });

    if (!journey_id || !UUID_RE.test(journey_id)) {
      console.warn("[crew/list] invalid journey_id", { journey_id });
      return NextResponse.json(
        { error: "journey_id is required (uuid)" },
        { status: 400 }
      );
    }
    if (vehicle_id && !UUID_RE.test(vehicle_id)) {
      console.warn("[crew/list] invalid vehicle_id", { vehicle_id });
      return NextResponse.json(
        { error: "vehicle_id must be a uuid" },
        { status: 400 }
      );
    }

    const sb = sbAdmin();

    let q = sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id:assignment_id, journey_id, vehicle_id, staff_id, status_simple, first_name, last_name, role_label"
      )
      .eq("journey_id", journey_id);

    if (vehicle_id) q = q.eq("vehicle_id", vehicle_id);

    const { data, error } = await q;

    if (error) {
      console.error("[crew/list] supabase error", {
        code: (error as any)?.code,
        message: error.message,
        details: (error as any)?.details,
        hint: (error as any)?.hint,
      });
      return NextResponse.json(
        { error: error.message || "Select failed" },
        { status: 500 }
      );
    }

    console.log("[crew/list] ok", {
      rows: data?.length ?? 0,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, data: data || [] }, { status: 200 });
  } catch (e: any) {
    console.error("[crew/list] FATAL", {
      message: e?.message,
      stack: e?.stack,
      ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
