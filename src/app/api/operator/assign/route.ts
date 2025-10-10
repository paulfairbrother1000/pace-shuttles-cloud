// src/app/api/operator/assign/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { assignLead } from "@/lib/opsAssign";

// ...
await assignLead(journeyId, vehicleId, staffId);
// then refresh your v_journey_staff_min / v_crew_assignments_min read as you already do


/**
 * Assign (or reassign) a lead crew member to a journey+vehicle.
 * Body: { journey_id: string, vehicle_id: string, staff_id: string }
 * Returns the updated minimal assignment view row.
 */
export async function POST(req: Request) {
  try {
    const { journey_id, vehicle_id, staff_id } = await req.json();

    if (!journey_id || !vehicle_id || !staff_id) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
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
            // @ts-ignore – next/headers types are a bit loose here
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            // emulate remove by expiring
            // @ts-ignore
            cookieStore.set({ name, value: "", expires: new Date(0), ...options });
          },
        },
      }
    );

    // Ensure the user is signed in (RLS uses this)
    const { data: { user }, error: uerr } = await supabase.auth.getUser();
    if (uerr || !user) {
      return NextResponse.json({ error: "Unauthenticated." }, { status: 401 });
    }

    // Upsert the assignment. Expecting a unique constraint on (journey_id, vehicle_id).
    // status_simple/assigned_at can also be set by DB defaults/triggers if you prefer.
    const { error: insErr } = await supabase
      .from("journey_assignments")
      .upsert(
        {
          journey_id,
          vehicle_id,
          staff_id,
          status_simple: "allocated",
          assigned_at: new Date().toISOString(),
        },
        { onConflict: "journey_id,vehicle_id" }
      );

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    // Return the freshly updated view row used by the UI
    const { data: viewRow, error: vErr } = await supabase
      .from("v_journey_staff_min")
      .select("journey_id,vehicle_id,staff_id,status_simple,first_name,last_name")
      .eq("journey_id", journey_id)
      .eq("vehicle_id", vehicle_id)
      .maybeSingle();

    if (vErr) {
      // still return 200 with no view row; UI will re-fetch if needed
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, assignment: viewRow }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export {};
