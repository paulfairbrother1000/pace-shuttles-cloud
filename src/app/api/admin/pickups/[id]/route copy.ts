// src/app/api/admin/pickups/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePublicUrl(publicUrl: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(publicUrl);
    const marker = "/storage/v1/object/public/";
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    const after = u.pathname.slice(i + marker.length);
    const slash = after.indexOf("/");
    if (slash === -1) return null;
    return { bucket: after.slice(0, slash), path: after.slice(slash + 1) };
  } catch {
    return null;
  }
}

/** Debug helper to verify the route exists */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: true, id: params.id, methods: ["GET", "PATCH", "DELETE"] });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !service) {
      return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    }
    const sb = createClient(url, service, { auth: { persistSession: false } });

    const updates = await req.json().catch(() => ({}));
    const allowed = {
      name: updates?.name,
      country_id: updates?.country_id,
      transport_type_id: updates?.transport_type_id,
      transport_type_place_id: updates?.transport_type_place_id,
      description: updates?.description,
      address1: updates?.address1,
      address2: updates?.address2,
      town: updates?.town,
      region: updates?.region,
      postal_code: updates?.postal_code,
      picture_url: updates?.picture_url,
    };

    // remove undefined keys so we only update provided fields
    Object.keys(allowed).forEach((k) => allowed[k as keyof typeof allowed] === undefined && delete (allowed as any)[k]);

    const { error } = await sb.from("pickup_points").update(allowed).eq("id", params.id);
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
    if (!url || !service) {
      return NextResponse.json({ error: "Missing Supabase env vars" }, { status: 500 });
    }
    const sb = createClient(url, service, { auth: { persistSession: false } });
    const id = params.id;

    // 1) Load row to get picture_url
    const { data: row, error: readErr } = await sb
      .from("pickup_points")
      .select("id, picture_url")
      .eq("id", id)
      .single();

    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // 2) Best-effort: remove image
    if (row.picture_url) {
      const info = parsePublicUrl(row.picture_url);
      if (info) {
        const { error: rmErr } = await sb.storage.from(info.bucket).remove([info.path]);
        if (rmErr) console.warn("Storage delete failed:", rmErr.message);
      }
    }

    // 3) Delete DB row
    const { error: delErr } = await sb.from("pickup_points").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
