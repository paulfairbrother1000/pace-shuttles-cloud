import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const serviceDb = createClient(URL, SERVICE);

/** Next 15-safe cookie store */
async function getCookieStore() {
  const c: any = (cookies as any)();
  return typeof c?.then === "function" ? await c : c;
}
async function authClient() {
  const store = await getCookieStore();
  return createServerClient(URL, ANON, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) =>
        store.set({ name, value, ...options }),
      remove: (name: string, options: CookieOptions) =>
        store.set({ name, value: "", ...options }),
    },
  });
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/crew/auto-link
 *
 * Bulk-permissive linking:
 * - Requires an authenticated user with an email.
 * - Finds ALL operator_staff rows with email ILIKE the user email.
 * - Updates any that are not already linked to this user.
 * - Idempotent; never 409s. Returns counts + updated staff_ids.
 */
export async function POST(_req: NextRequest) {
  try {
    const supa = await authClient();
    const { data: sess } = await supa.auth.getUser();
    const u = sess?.user;

    if (!u) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!u.email) return NextResponse.json({ error: "User has no email" }, { status: 400 });

    const email = u.email.trim();

    // All matches by email (case-insensitive)
    const { data: toLink, error: findErr } = await serviceDb
      .from("operator_staff")
      .select("id, user_id")
      .ilike("email", email);

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 400 });

    if (!toLink || toLink.length === 0) {
      return NextResponse.json({
        ok: true,
        matched: 0,
        updated: 0,
        staff_ids: [],
        note: "No operator_staff rows matched this email.",
      });
    }

    // Only update rows not already linked to this user
    const needsUpdate = toLink.filter((r) => r.user_id !== u.id);
    if (needsUpdate.length === 0) {
      return NextResponse.json({
        ok: true,
        matched: toLink.length,
        updated: 0,
        staff_ids: [],
        note: "Already linked.",
      });
    }

    const ids = needsUpdate.map((r) => r.id);
    const { error: updErr } = await serviceDb
      .from("operator_staff")
      .update({ user_id: u.id })
      .in("id", ids);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      matched: toLink.length,
      updated: ids.length,
      staff_ids: ids,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
