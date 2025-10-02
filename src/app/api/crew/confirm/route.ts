import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// ---- inlined helpers (no ) ----
function crewOpsEnabled(): boolean {
  return String(process.env.NEXT_PUBLIC_CREW_OPS_ENABLED).toLowerCase() === "true";
}
function getSb() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value } }
  );
}
// --------------------------------------

export async function POST(req: NextRequest) {
  if (!crewOpsEnabled()) return new Response("Not enabled", { status: 404 });

  const sb = getSb();

  let body: { assignmentId?: string };
  try { body = await req.json(); } catch { return new Response("Invalid JSON body", { status: 400 }); }
  const assignmentId = body.assignmentId?.trim();
  if (!assignmentId) return new Response("assignmentId required", { status: 400 });

  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return new Response("Unauthorized", { status: 401 });

  const { data: staffRows, error: staffErr } = await sb
    .from("operator_staff").select("id").eq("user_id", user.id).eq("active", true);
  if (staffErr) return new Response(staffErr.message, { status: 400 });
  const staffIds = (staffRows ?? []).map(r => r.id);
  if (staffIds.length === 0) return new Response("No staff record for user", { status: 403 });

  const { error } = await sb
    .from("journey_crew_assignments")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .in("staff_id", staffIds);

  if (error) return new Response(error.message, { status: 400 });
  return new Response("ok");
}

// Optional sanity check
export async function GET() {
  return new Response("confirm route alive");
}

export {};
