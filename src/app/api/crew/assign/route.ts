// src/app/api/crew/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { journey_id, vehicle_id, role, staff_id, staff_ids } = body || {};

  if (!journey_id || !vehicle_id || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          try { cookieStore.set({ name, value, ...options }); } catch {}
        },
        remove(name: string, options: any) {
          try { cookieStore.set({ name, value: "", ...options }); } catch {}
        },
      },
    }
  );

  // Auth and operator context (same approach as elsewhere)
  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user;
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Load journey + vehicle to determine operator
  const { data: j } = await supabase.from("journeys").select("id, route_id, departure_ts").eq("id", journey_id).maybeSingle();
  if (!j) return NextResponse.json({ error: "Journey not found" }, { status: 404 });

  const { data: v } = await supabase.from("vehicles").select("id, operator_id").eq("id", vehicle_id).maybeSingle();
  if (!v) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  // Build list of staff to assign
  const targets: string[] = role === "crew" ? ([] as string[]).concat(...(staff_ids || [])) : [staff_id];
  if (!targets.length || targets.some((x: any) => !x)) {
    return NextResponse.json({ error: "No staff selected" }, { status: 400 });
  }

  // Check all staff belong to same operator and are active
  const { data: staffRows } = await supabase
    .from("operator_staff")
    .select("id, operator_id, active")
    .in("id", targets);
  if (!staffRows?.length || staffRows.some(s => s.operator_id !== v.operator_id || s.active === false)) {
    return NextResponse.json({ error: "Staff not eligible" }, { status: 400 });
  }

  // Availability ±6h
  const dep = new Date(j.departure_ts).getTime();
  const sixH = 6 * 60 * 60 * 1000;

  const { data: existing } = await supabase
    .from("v_crew_assignments_min")
    .select("staff_id, departure_ts, status_simple");
  const conflicts = new Set<string>();
  (existing || []).forEach((a: any) => {
    if (!a.departure_ts) return;
    const t = new Date(a.departure_ts).getTime();
    if (Math.abs(t - dep) < sixH && (a.status_simple === "allocated" || a.status_simple === "confirmed")) {
      conflicts.add(a.staff_id);
    }
  });
  const blocked = targets.filter(t => conflicts.has(t));
  if (blocked.length) {
    return NextResponse.json({ error: "One or more staff are not available" }, { status: 409 });
  }

  // Upsert assignments
  if (role === "lead") {
    // Remove any existing lead for this journey+vehicle, then insert
    await supabase
      .from("journey_assignments")
      .delete()
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .neq("role_label", "Crew"); // assume non-crew is lead
    const { error } = await supabase.from("journey_assignments").insert({
      journey_id, vehicle_id, staff_id: targets[0], status_simple: "allocated",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // crew: insert any that don't already exist
    for (const sid of targets) {
      const { data: exists } = await supabase
        .from("journey_assignments")
        .select("id")
        .eq("journey_id", journey_id)
        .eq("vehicle_id", vehicle_id)
        .eq("staff_id", sid)
        .limit(1);
      if (!exists || !exists.length) {
        const { error } = await supabase.from("journey_assignments").insert({
          journey_id, vehicle_id, staff_id: sid, status_simple: "allocated", role_label: "Crew",
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
