import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

/* ----- Auth helpers (Next 15-safe) ----- */
async function getCookieStore() {
  const c: any = (cookies as any)();
  return typeof c?.then === "function" ? await c : c;
}
async function authClient() {
  const store = await getCookieStore();
  return createServerClient(URL, ANON, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => store.set({ name, value, ...options }),
      remove: (name: string, options: CookieOptions) => store.set({ name, value: "", ...options }),
    },
  });
}
async function operatorIdFromAuth(): Promise<string | null> {
  try {
    const supa = await authClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user?.email) return null;
    const { data: op } = await db
      .from("operators")
      .select("id")
      .ilike("admin_email", user.email)
      .maybeSingle();
    return op?.id ?? null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

/**
 * GET lists staff for an operator.
 * Accepts either:
 *  - auth-derived operator, OR
 *  - ?operatorId=... (dev convenience), OR
 *  - 401 if neither provided
 */
export async function GET(req: NextRequest) {
  const urlOp = req.nextUrl.searchParams.get("operatorId");
  const authOp = await operatorIdFromAuth();
  const operatorId = urlOp || authOp;

  if (!operatorId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: staff, error: sErr } = await db
    .from("operator_staff")
    .select("*")
    .eq("operator_id", operatorId)
    .order("created_at", { ascending: false });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 400 });

  const { data: rels } = await db
    .from("operator_transport_types")
    .select("journey_type_id")
    .eq("operator_id", operatorId);
  const jtIds = (rels ?? []).map((r: any) => r.journey_type_id);

  const { data: types } = jtIds.length
    ? await db.from("journey_types").select("id,name").in("id", jtIds)
    : { data: [] as any[] };

  let roles: any[] = [];
  const rolesRes = await db.from("transport_type_role").select("type_id,name");
  if (!rolesRes.error && rolesRes.data) roles = rolesRes.data;

  return NextResponse.json({
    ok: true,
    operator_id: operatorId,
    data: staff ?? [],
    allowed_types: types ?? [],
    roles,
  });
}

/**
 * POST creates staff. DEV-FRIENDLY:
 * 1) Prefer body.operator_id (since the form selects it)
 * 2) Else fall back to auth-derived operator
 * 3) 401 only if neither is available
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, any>));

  // Prefer explicit operator_id from the request (form)
  let operatorId: string | null = body?.operator_id ?? null;
  if (!operatorId) operatorId = await operatorIdFromAuth();
  if (!operatorId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Validate required fields
  for (const k of ["type_id", "first_name", "last_name"]) {
    if (!body[k]) return NextResponse.json({ error: `${k} required` }, { status: 400 });
  }

  // Ensure selected type belongs to the operator
  const { data: allowed } = await db
    .from("operator_transport_types")
    .select("journey_type_id")
    .eq("operator_id", operatorId)
    .eq("journey_type_id", body.type_id)
    .maybeSingle();
  if (!allowed) {
    return NextResponse.json({ error: "Transport type not allowed for this operator" }, { status: 403 });
  }

  const rec = {
    operator_id: operatorId,
    type_id: body.type_id,
    jobrole: body.jobrole ?? null,
    first_name: body.first_name,
    last_name: body.last_name,
    status: body.status ?? "Active",
    licenses: body.licenses ?? null,
    notes: body.notes ?? null,
    photo_url: body.photo_url ?? null,
  };

  const { data, error } = await db.from("operator_staff").insert(rec).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, id: data?.id });
}

export {};
