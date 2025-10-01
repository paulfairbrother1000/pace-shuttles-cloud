// Next.js App Router route handler: POST /api/operator/routes/assign
export const dynamic = "force-dynamic";

type AssignPayload = {
  operatorId: string;
  routeId: string;
  vehicleIds: string[];
  preferredVehicleId: string;
};

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<AssignPayload>;

    // minimal validation
    if (!body?.operatorId) return bad("operatorId required");
    if (!body?.routeId) return bad("routeId required");
    if (!Array.isArray(body?.vehicleIds) || body.vehicleIds.length === 0)
      return bad("vehicleIds must be a non-empty array");
    if (!body?.preferredVehicleId) return bad("preferredVehicleId required");

    // ───────────────────────────────────────────────────────────────
    // TODO: Persist the assignment to your DB.
    // - Don't hardcode "boat": use your transport types as you already do in the UI.
    // - You mentioned not to guess tables; wire this to your actual tables here.
    //
    // Example sketch (commented out): call your RPC or upsert rows.
    //
    // import { createClient } from "@supabase/supabase-js";
    // const supabase = createClient(
    //   process.env.NEXT_PUBLIC_SUPABASE_URL!,
    //   process.env.SUPABASE_SERVICE_ROLE_KEY! // server-side secret
    // );
    // const { error } = await supabase.rpc("assign_route_vehicles", {
    //   p_operator_id: body.operatorId,
    //   p_route_id: body.routeId,
    //   p_vehicle_ids: body.vehicleIds,
    //   p_preferred_vehicle_id: body.preferredVehicleId,
    // });
    // if (error) return bad(error.message, 500);
    // ───────────────────────────────────────────────────────────────

    // Temporary success so the UI shows “Assigned ✅”
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return bad(err?.message ?? "Invalid JSON", 400);
  }
}

// Optional: reject non-POSTs explicitly (prevents 405 from Next’s default)
export async function GET() {
  return bad("Method Not Allowed", 405);
}
