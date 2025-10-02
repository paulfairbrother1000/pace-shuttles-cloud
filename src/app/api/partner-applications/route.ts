// src/app/api/partner-applications/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** ===== Env ===== */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SRV_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sbAdmin() {
  return createClient(SUPABASE_URL, SRV_KEY, { auth: { persistSession: false } });
}

function isUuid(s: unknown) {
  return typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
}

/** Basic field cleaning */
function cleanStr(x: unknown) {
  if (x == null) return null;
  const s = String(x).trim();
  return s.length ? s : null;
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SRV_KEY) {
      // Important: this tells us if the server process doesn't have the service key
      return NextResponse.json({ ok: false, error: "Server not configured (missing SUPABASE_SERVICE_ROLE_KEY)" }, { status: 500 });
    }

    // ── Debug: confirm which DB role we're using ──────────────────────────────
    try {
      const db = sbAdmin();
      // Optional RPC you can create:
      //   create or replace function http_role_whoami()
      //   returns json language sql stable as
      //   $$ select json_build_object('db', current_database(), 'role', current_role, 'current_user', current_user) $$;
      const { data, error } = await db.rpc("http_role_whoami");
      console.log("[partner-applications] whoami:", data || null, error?.message || null);
    } catch (e) {
      // If this fails, it's fine — we only use it for diagnostics
      console.log("[partner-applications] whoami call failed:", (e as any)?.message || e);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const json = await req.json().catch(() => ({} as any));

    // Required discriminator
    const application_type = (json.application_type || json.type || "").toString().toLowerCase();
    if (application_type !== "operator" && application_type !== "destination") {
      return NextResponse.json({ ok: false, error: "application_type must be 'operator' or 'destination'" }, { status: 400 });
    }

    // Attempt to fetch authenticated user for submitted_by
    let submitted_by: string | null = null;
    try {
      const jar = await cookies();
      const sb = createServerClient(SUPABASE_URL, ANON, {
        cookies: {
          get: (name: string) => jar.get(name)?.value,
          set: (name, value, options) => jar.set(name, value, options),
          remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
        },
      });
      const { data: auth } = await sb.auth.getUser();
      submitted_by = auth?.user?.id || null;
    } catch {
      /* no-op */
    }

    // Common fields
    const country_id = isUuid(json.country_id) ? json.country_id : null;

    const org_name = cleanStr(json.org_name);
    if (!org_name) {
      return NextResponse.json({ ok: false, error: "Organisation name is required" }, { status: 400 });
    }

    const payload: any = {
      application_type,
      status: "new",
      admin_notes: null,
      country_id,

      // org & contact
      org_name,
      org_address: cleanStr(json.org_address),
      telephone: cleanStr(json.telephone),
      mobile: cleanStr(json.mobile),
      email: cleanStr(json.email),
      website: cleanStr(json.website),
      social_instagram: cleanStr(json.social_instagram),
      social_youtube: cleanStr(json.social_youtube),
      social_x: cleanStr(json.social_x),
      social_facebook: cleanStr(json.social_facebook),
      contact_name: cleanStr(json.contact_name),
      contact_role: cleanStr(json.contact_role),
      years_operation: Number.isFinite(Number(json.years_operation)) ? Math.max(0, Number(json.years_operation)) : null,

      // Suggestions (free text)
      pickup_suggestions: cleanStr(json.pickup_suggestions),
      destination_suggestions: cleanStr(json.destination_suggestions),

      description: cleanStr(json.description),

      submitted_by,
    };

    // Operator-specific
    if (application_type === "operator") {
      payload.transport_type_id = isUuid(json.transport_type_id) ? json.transport_type_id : null;
      if (!payload.transport_type_id) {
        return NextResponse.json({ ok: false, error: "transport_type_id is required for operators" }, { status: 400 });
      }
      payload.fleet_size = Number.isFinite(Number(json.fleet_size)) ? Math.max(0, Number(json.fleet_size)) : null;
    }

    // Destination-specific
    if (application_type === "destination") {
      payload.destination_type_id = isUuid(json.destination_type_id) ? json.destination_type_id : null;
      if (!payload.destination_type_id) {
        return NextResponse.json({ ok: false, error: "destination_type_id is required for destinations" }, { status: 400 });
      }
    }

    // Insert main row with the service-role client
    const admin = sbAdmin();
    const { data: inserted, error: insErr } = await admin
      .from("partner_applications")
      .insert(payload)
      .select("id, transport_type_id")
      .single();

    if (insErr || !inserted) {
      // Surface exact Postgres error back to the page for faster diagnosis
      return NextResponse.json({ ok: false, error: insErr?.message || "Insert failed" }, { status: 500 });
    }

    const appId = inserted.id;

    // Optional: arrival place selections (only valid if we also have a transport_type_id)
    const placeIds: string[] = Array.isArray(json.place_ids) ? json.place_ids.filter(isUuid) : [];
    if (placeIds.length) {
      const rows = placeIds.map((pid) => ({ application_id: appId, place_id: pid }));
      const { error: placeErr } = await admin.from("partner_application_places").insert(rows);
      if (placeErr) {
        // Not fatal — just log
        console.warn("[partner-applications] place insert warning:", placeErr.message);
      }
    }

    return NextResponse.json({ ok: true, id: appId });
  } catch (e: any) {
    console.error("[partner-applications] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal error" }, { status: 500 });
  }
}

// If a GET hits this endpoint, respond clearly instead of returning an empty body
export async function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export {};
