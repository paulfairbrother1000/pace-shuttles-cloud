// src/app/api/ops/assign/crew/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type UUID = string;

/* ---------- tiny helpers (inlined to avoid ../_util import) ---------- */
const json = (data: any, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

const ok = (data: any = { ok: true }) => json(data, 200);
const fail = (message: string, status = 400) => json({ error: message }, status);

const isUuid = (v?: string | null) =>
  !!v &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function sbServer() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (key: string) => store.get(key)?.value,
        set() {},
        remove() {},
      },
    }
  );
}

/** Choose a staff member if not provided: active, same operator as vehicle, prefer captain/skipper */
async function resolveStaffIfNeeded(
  sb: ReturnType<typeof sbServer>,
  vehicle_id?: UUID | null,
  staff_id?: UUID | null
): Promise<UUID> {
  if (staff_id) return staff_id;
  if (!vehicle_id) throw new Error("staff_id missing and vehicle_id not provided");

  const { data: vehicle, error: vehErr } = await sb
    .from("vehicles")
    .select("operator_id")
    .eq("id", vehicle_id)
    .maybeSingle();
  if (vehErr) throw new Error(vehErr.message || "Vehicle lookup failed");
  if (!vehicle?.operator_id) throw new Error("Vehicle has no operator_id");

  const { data: staffRows, error: stErr } = await sb
    .from("operator_staff")
    .select("id, active, jobrole")
    .eq("operator_id", vehicle.operator_id)
    .eq("active", true)
    .limit(50);
  if (stErr) throw new Error(stErr.message || "Staff lookup failed");

  const norm = (s?: string | null) => String(s ?? "").trim().toLowerCase();
  const candidates = (staffRows ?? []).filter((s: any) => norm(s?.jobrole) !== "crew");
  const preferred =
    candidates.find((s: any) => ["captain", "skipper"].includes(norm(s?.jobrole))) ??
    candidates[0];

  const chosen = preferred?.id as UUID | undefined;
  if (!chosen) throw new Error("No eligible staff found for this operator");
  return chosen;
}

/* ---------- POST /api/ops/assign/crew ---------- */
export async function POST(req: Request) {
  try {
    const sb = sbServer();

    let body: {
      journey_id?: UUID;
      vehicle_id?: UUID | null;
      staff_id?: UUID | null;
      role_id?: UUID | null; // optional
    };
    try {
      body = await req.json();
    } catch {
      return fail("Invalid JSON body", 400);
    }

    const { journey_id, vehicle_id, staff_id, role_id } = body || {};

    if (!isUuid(journey_id)) return fail("journey_id is required (uuid)", 422);
    if (vehicle_id && !isUuid(vehicle_id)) return fail("vehicle_id must be a uuid", 422);
    if (staff_id && !isUuid(staff_id)) return fail("staff_id must be a uuid", 422);
    if (role_id && !isUuid(role_id)) return fail("role_id must be a uuid", 422);

    const chosenStaff = await resolveStaffIfNeeded(sb, vehicle_id ?? null, staff_id ?? null);

    // Call your RPC for assigning crew (not lead). Adjust RPC name if yours differs.
    const { data, error } = await sb.rpc("ops_assign_crew", {
      p_journey_id: journey_id,
      p_vehicle_id: vehicle_id ?? null,
      p_staff_id: chosenStaff,
      p_role_id: role_id ?? null,
    });

    if (error) {
      // Map common PG/RPC errors to HTTP codes
      const code = (error.code as string) || "";
      const msg = (error.message as string) || "RPC failed";

      if (code === "23505") return json({ error: "Conflict" }, 409);
      if (code === "23503" || /not found|invalid|eligible|uuid/i.test(msg))
        return json({ error: msg }, 422);
      if (code === "42501" || /permission|forbidden|rls|unauthor/i.test(msg))
        return json({ error: "Forbidden" }, 403);

      return fail(msg, 400);
    }

    return ok({ ok: true, data });
  } catch (e: any) {
    return fail(e?.message ?? "Unexpected error", 500);
  }
}
