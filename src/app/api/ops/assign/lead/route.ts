// src/app/api/ops/assign/lead/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type UUID = string;

function sb() {
  const jar = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => jar.get(n)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  );
}

const AVAIL_BUFFER_MIN = Number(process.env.AVAIL_BUFFER_MINUTES || 30);

// ----- Helpers -----
async function utc(ts: string | Date) {
  return new Date(ts);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

async function getJourneyAndVehicle(client: ReturnType<typeof sb>, journey_id: UUID, vehicle_id: UUID) {
  const [{ data: j, error: je }, { data: v, error: ve }] = await Promise.all([
    client.from("journeys").select("id, route_id, operator_id, departure_ts").eq("id", journey_id).maybeSingle(),
    client.from("vehicles").select("id, operator_id").eq("id", vehicle_id).maybeSingle(),
  ]);
  if (je || !j) throw new Error("Journey not found");
  if (ve || !v) throw new Error("Vehicle not found");
  if (j.operator_id !== v.operator_id) throw new Error("Journey/vehicle operator mismatch");
  return { j, v };
}

async function getEligibleCaptainsForVehicle(
  client: ReturnType<typeof sb>,
  operator_id: UUID,
  vehicle_id: UUID,
  dep: Date
) {
  // lead-eligible & active for this vehicle
  const { data: rows, error } = await client
    .from("staff_vehicle_assignments")
    .select("staff_id, priority, operator_id")
    .eq("operator_id", operator_id)
    .eq("vehicle_id", vehicle_id)
    .eq("is_lead_eligible", true);
  if (error) throw error;
  const staffIds = (rows ?? []).map(r => r.staff_id);
  if (!staffIds.length) return [];

  // fetch active staff
  const { data: staff } = await client
    .from("operator_staff")
    .select("id, first_name, last_name, active")
    .in("id", staffIds)
    .eq("active", true);

  const activeIds = new Set((staff ?? []).map(s => s.id));
  const eligible = (rows ?? []).filter(r => activeIds.has(r.staff_id));

  // availability: ±30min around departure
  const start = new Date(dep.getTime() - AVAIL_BUFFER_MIN * 60 * 1000);
  const end   = new Date(dep.getTime() + AVAIL_BUFFER_MIN * 60 * 1000);

  // assignments for those staff near that time
  const { data: assigns } = await client
    .from("journey_assignments")
    .select("staff_id, journey_id, status, is_lead, ja_journeys:journeys!inner(departure_ts)")
    .in("staff_id", eligible.map(e => e.staff_id))
    .in("status", ["assigned","confirmed"]);

  const blocked = new Set<string>();
  (assigns ?? []).forEach(a => {
    const other = new Date((a as any).ja_journeys.departure_ts);
    const oStart = new Date(other.getTime() - AVAIL_BUFFER_MIN * 60 * 1000);
    const oEnd   = new Date(other.getTime() + AVAIL_BUFFER_MIN * 60 * 1000);
    if (overlaps(start, end, oStart, oEnd)) blocked.add((a as any).staff_id);
  });

  // unavailability overlap
  const { data: unav } = await client
    .from("staff_unavailability")
    .select("staff_id, start_ts, end_ts")
    .in("staff_id", eligible.map(e => e.staff_id));
  const blockedUn = new Set<string>();
  (unav ?? []).forEach(u => {
    if (overlaps(start, end, new Date(u.start_ts), new Date(u.end_ts))) blockedUn.add(u.staff_id);
  });

  return eligible
    .filter(e => !blocked.has(e.staff_id) && !blockedUn.has(e.staff_id))
    .map(e => ({ staff_id: e.staff_id, priority: e.priority }));
}

async function fairUseOrder(
  client: ReturnType<typeof sb>,
  vehicle_id: UUID,
  operator_id: UUID,
  candidates: { staff_id: UUID; priority: number }[]
) {
  if (!candidates.length) return [];
  const ids = candidates.map(c => c.staff_id);

  // last 30d + last 20 (vehicle-specific), fallback operator-wide
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: vehCounts } = await client
    .from("captain_fairuse_ledger")
    .select("staff_id, confirmed, assigned_at, vehicle_id")
    .eq("vehicle_id", vehicle_id)
    .in("staff_id", ids)
    .gte("assigned_at", since30);

  const last30CountByStaff = new Map<UUID, number>();
  (vehCounts ?? []).forEach(r => {
    last30CountByStaff.set(r.staff_id, (last30CountByStaff.get(r.staff_id) || 0) + 1);
  });

  // last 20 confirmed for this vehicle
  const { data: vehLast20 } = await client
    .from("captain_fairuse_ledger")
    .select("staff_id, assigned_at")
    .eq("vehicle_id", vehicle_id)
    .order("assigned_at", { ascending: false })
    .limit(200); // get enough, we'll count per staff

  const last20Count = new Map<UUID, number>();
  if (vehLast20?.length) {
    const perStaff: Record<string, number> = {};
    for (const row of vehLast20) {
      perStaff[row.staff_id] = (perStaff[row.staff_id] || 0) + 1;
    }
    for (const sid of ids) last20Count.set(sid, perStaff[sid] || 0);
  }

  // If vehicle history is empty for some staff, fallback to operator-wide counts
  const { data: opCounts } = await client
    .from("captain_fairuse_ledger")
    .select("staff_id, assigned_at, operator_id")
    .eq("operator_id", operator_id)
    .in("staff_id", ids)
    .gte("assigned_at", since30);

  const opLast30 = new Map<UUID, number>();
  (opCounts ?? []).forEach(r => {
    opLast30.set(r.staff_id, (opLast30.get(r.staff_id) || 0) + 1);
  });

  // Build score: priority asc, then min(vehicle last30 or op last30), then vehicle last20, then tie-break by name hashable id
  function score(sid: UUID) {
    const v30 = last30CountByStaff.get(sid);
    const v20 = last20Count.get(sid);
    const fallback = opLast30.get(sid) ?? 0;
    const use30 = (v30 ?? null) === null ? fallback : v30!;
    return { use30, v20: v20 ?? 0 };
  }

  const out = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const sa = score(a.staff_id), sb = score(b.staff_id);
    if (sa.use30 !== sb.use30) return sa.use30 - sb.use30;
    if (sa.v20 !== sb.v20) return sa.v20 - sb.v20;
    return a.staff_id.localeCompare(b.staff_id);
  });
  return out;
}

// ----- Handler -----
export async function POST(req: NextRequest) {
  try {
    const client = sb();

    const body = await req.json().catch(() => ({}));
    const { journey_id, vehicle_id, staff_id } = body as {
      journey_id?: UUID;
      vehicle_id?: UUID;
      staff_id?: UUID;
    };

    if (!journey_id || !vehicle_id) {
      return NextResponse.json({ error: "journey_id and vehicle_id are required" }, { status: 400 });
    }

    // ensure user authenticated (op admin ideally – left as TODO/your RBAC)
    const { data: ures } = await client.auth.getUser();
    if (!ures?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { j, v } = await getJourneyAndVehicle(client, journey_id, vehicle_id);
    const dep = await utc(j.departure_ts);

    // Enforce single lead per (journey, vehicle)
    const { data: existing } = await client
      .from("journey_assignments")
      .select("id, status")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("is_lead", true)
      .in("status", ["assigned", "confirmed"])
      .limit(1);

    if (existing && existing.length) {
      return NextResponse.json({ error: "Lead already assigned" }, { status: 409 });
    }

    // If explicit staff supplied, validate eligibility/availability
    let target: { staff_id: UUID; priority: number } | null = null;

    if (staff_id) {
      const eligible = await getEligibleCaptainsForVehicle(client, v.operator_id, vehicle_id, dep);
      const found = eligible.find(e => e.staff_id === staff_id);
      if (!found) {
        return NextResponse.json({ error: "Captain is unavailable or not lead-eligible for this vehicle" }, { status: 422 });
      }
      target = found;
    } else {
      // Auto-pick
      const eligible = await getEligibleCaptainsForVehicle(client, v.operator_id, vehicle_id, dep);
      if (!eligible.length) {
        return NextResponse.json({ error: "No eligible captain available" }, { status: 422 });
      }
      const ordered = await fairUseOrder(client, vehicle_id, v.operator_id, eligible);
      target = ordered[0];
    }

    // Replace any dormant leads (if any exist with other statuses)
    await client
      .from("journey_assignments")
      .update({ status: "unavailable" })
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .eq("is_lead", true)
      .neq("status", "unavailable");

    const insert = await client
      .from("journey_assignments")
      .insert({
        journey_id,
        vehicle_id,
        staff_id: target!.staff_id,
        is_lead: true,
        status: "assigned",
        status_simple: "allocated",
        assigned_by: "operator",
        assigned_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insert.error || !insert.data) {
      return NextResponse.json({ error: insert.error?.message || "Assign failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, assignment_id: insert.data.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
// at bottom of both route files
export async function GET(req: Request) {
  // just call POST to keep logic in one place
  // @ts-ignore
  return POST(req as any);
}
