// src/app/api/ops/assign/_util.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
// src/app/api/ops/assign/_util.ts
import { NextResponse } from "next/server";

/** JSON helpers */
export const json = (data: any, init?: number | ResponseInit) =>
  NextResponse.json(
    data,
    typeof init === "number" ? { status: init } : init
  );

export const ok = (data: any = { ok: true }, init?: number | ResponseInit) =>
  json(data, init);

export const fail = (message: string, status = 400) =>
  json({ error: message }, { status });

export const badRequest = (message = "Bad request") => fail(message, 400);
export const unauthorized = (message = "Unauthorized") => fail(message, 401);
export const forbidden = (message = "Forbidden") => fail(message, 403);
export const notFound = (message = "Not found") => fail(message, 404);
export const methodNotAllowed = (message = "Method Not Allowed") => fail(message, 405);

/** Guard a specific method in a Route Handler */
export function requireMethod(req: Request, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
  if (req.method !== method) return methodNotAllowed();
  return null;
}

/** Safe body parse */
export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

/** Simple UUID check (optional) */
export function isUUID(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}


export type UUID = string;

/* ---------- Small utils ---------- */
export const isUuid = (v?: string | null) =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();

/* ---------- Supabase (server) with caller's session ---------- */
export function sbServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (k: string) => cookieStore.get(k)?.value,
        set() {},
        remove() {},
      },
    }
  );
}

/* ---------- Staff resolution ---------- */
/**
 * Resolve staff if not provided:
 * - Same operator as the vehicle
 * - active = true
 * - excludes jobrole 'crew'
 * - prefers jobrole 'captain' or 'skipper' if available, else first non-crew
 */
export async function resolveStaffIfNeeded(
  sb: ReturnType<typeof sbServer>,
  vehicle_id?: UUID | null,
  staff_id?: UUID | null
): Promise<UUID> {
  if (staff_id) return staff_id;
  if (!vehicle_id) {
    throw new Error("staff_id is missing and vehicle_id not provided to resolve staff");
  }

  // 1) Get the vehicle's operator
  const { data: vehicle, error: vehErr } = await sb
    .from("vehicles")
    .select("operator_id")
    .eq("id", vehicle_id)
    .maybeSingle();

  if (vehErr) throw new Error(vehErr.message || "Vehicle lookup failed");
  if (!vehicle?.operator_id) throw new Error("Vehicle has no operator_id");

  // 2) Fetch active staff for that operator
  const { data: staffRows, error: stErr } = await sb
    .from("operator_staff")
    .select("id, active, jobrole")
    .eq("operator_id", vehicle.operator_id)
    .eq("active", true)
    .limit(50);

  if (stErr) throw new Error(stErr.message || "Staff lookup failed");

  const rows = (staffRows ?? []).filter((s: any) => norm(s?.jobrole) !== "crew");

  // Prefer captain or skipper
  const preferred =
    rows.find((s: any) => ["captain", "skipper"].includes(norm(s?.jobrole))) ??
    rows[0];

  const chosen = preferred?.id as UUID | undefined;
  if (!chosen) throw new Error("No eligible staff found for this operator");
  return chosen;
}

/* ---------- Optional compact view refresh for UI ---------- */
export async function refreshCrewView(
  sb: ReturnType<typeof sbServer>,
  journey_id: UUID
) {
  try {
    const { data, error } = await sb
      .from("v_crew_assignments_min")
      .select(
        "assignment_id, journey_id, vehicle_id, staff_id, role_label, first_name, last_name, status_simple, is_lead"
      )
      .eq("journey_id", journey_id);

    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

/* ---------- RPC thin wrapper ---------- */
export async function rpcAssign(
  sb: ReturnType<typeof sbServer>,
  rpcName: "ops_assign_lead" | "ops_assign_captain" | "ops_assign_crew",
  args: { p_journey_id: UUID; p_staff_id: UUID; p_vehicle_id?: UUID | null; p_role_id?: UUID | null }
) {
  return sb.rpc(rpcName, args);
}

/* ---------- Error mapping ---------- */
export function mapRpcError(error: any): { code: number; body: { error: string } } {
  const msg = (error?.message as string) || "RPC failed";
  const code = (error?.code as string) || "";

  // Permission / RLS
  if (/permission|rls|forbidden|unauthor/i.test(msg) || code === "42501") {
    return { code: 403, body: { error: "Forbidden" } };
  }

  // Unique / conflict
  if (
    code === "23505" ||
    /unique|duplicate|already|only one|conflict/i.test(msg)
  ) {
    return { code: 409, body: { error: "Conflict" } };
  }

  // FK / not found / validation
  if (
    code === "23503" || // foreign_key_violation
    /invalid|not found|eligible|operator|vehicle|journey|uuid/i.test(msg)
  ) {
    return { code: 422, body: { error: msg } };
  }

  // Check constraint / data issues
  if (code === "23514") {
    return { code: 422, body: { error: msg } };
  }

  // Fallback
  return { code: 400, body: { error: msg } };
}
