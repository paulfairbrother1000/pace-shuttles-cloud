// src/app/api/admin/partner-applications/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbAdmin() {
  return createClient(SUPABASE_URL, SRV_KEY, { auth: { persistSession: false } });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // new|under_review|approved|declined
    const application_type = url.searchParams.get("application_type"); // operator|destination
    const q = url.searchParams.get("q")?.trim() || "";

    const db = sbAdmin();
    let query = db
      .from("partner_applications")
      .select("id,created_at,application_type,status,country_id,org_name,email,telephone,contact_name,transport_type_id,destination_type_id,fleet_size")
      .order("created_at", { ascending: false });

    if (status && status !== "all") query = query.eq("status", status);
    if (application_type && application_type !== "all") query = query.eq("application_type", application_type);

    if (q) {
      // simple OR filter via ilike on a few columns
      const or = [
        `org_name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `contact_name.ilike.%${q}%`,
        `telephone.ilike.%${q}%`,
      ].join(",");
      query = query.or(or);
    }

    const { data: apps, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const countryIds = Array.from(new Set((apps || []).map(a => a.country_id).filter(Boolean) as string[]));
    const ttypeIds = Array.from(new Set((apps || []).map(a => a.transport_type_id).filter(Boolean) as string[]));
    const dtypeIds = Array.from(new Set((apps || []).map(a => a.destination_type_id).filter(Boolean) as string[]));

    // lookups
    const [countries, ttypes, dtypes] = await Promise.all([
      countryIds.length ? db.from("countries").select("id,name").in("id", countryIds) : Promise.resolve({ data: [] as any[], error: null }),
      ttypeIds.length   ? db.from("transport_types").select("id,name").in("id", ttypeIds) : Promise.resolve({ data: [] as any[], error: null }),
      dtypeIds.length   ? db.from("destination_types").select("id,name").in("id", dtypeIds) : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    const countryMap = Object.fromEntries((countries.data || []).map((r: any) => [r.id, r.name]));
    const ttypeMap   = Object.fromEntries((ttypes.data || []).map((r: any) => [r.id, r.name]));
    const dtypeMap   = Object.fromEntries((dtypes.data || []).map((r: any) => [r.id, r.name]));

    const items = (apps || []).map((a: any) => ({
      ...a,
      country_name: a.country_id ? countryMap[a.country_id] ?? null : null,
      transport_type_name: a.transport_type_id ? ttypeMap[a.transport_type_id] ?? null : null,
      destination_type_name: a.destination_type_id ? dtypeMap[a.destination_type_id] ?? null : null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    console.error("[admin list apps] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}

export {};
