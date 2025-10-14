// src/app/api/ops/allocator/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ---------- Supabase (service) ---------- */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, service);

/* ---------- Helpers ---------- */
function hoursUntil(iso: string) {
  return (new Date(iso).getTime() - Date.now()) / 36e5;
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

export async function POST(req: NextRequest) {
  try {
    const { journeyId } = await req.json();
    if (!journeyId) return NextResponse.json({ error: "journeyId required" }, { status: 400 });

    // 1) Load journey + demand
    const { data: jRow, error: jErr } = await sb
      .from("journeys")
      .select("id, route_id, departure_ts, vehicle_id, operator_id, is_active")
      .eq("id", journeyId)
      .single();
    if (jErr || !jRow) throw jErr ?? new Error("Journey not found");
    if (!jRow.is_active) return NextResponse.json({ ok: true, message: "Inactive journey" });

    const depIso: string = jRow.departure_ts;
    const tHrs = hoursUntil(depIso);

    // demand (paid/reserved)
    let booked = 0;
    {
      const { data: counts, error } = await sb
        .from("journey_order_passenger_counts")
        .select("journey_id,pax")
        .eq("journey_id", journeyId)
        .maybeSingle();
      if (!error && counts) booked = Number(counts.pax) || 0;
      else {
        const { data: bks, error: eB } = await sb
          .from("bookings")
          .select("seats")
          .eq("journey_id", journeyId);
        if (eB) throw eB;
        booked = (bks ?? []).reduce((s, b: any) => s + (Number(b.seats) || 0), 0);
      }
    }

    // 2) Vehicle candidates from route_vehicle_assignments
    const { data: rvas, error: rvaErr } = await sb
      .from("route_vehicle_assignments")
      .select(`
        id, preferred, is_active,
        vehicles:vehicle_id(id, name, active, operator_id, minseats, maxseats, minvalue, maxseatdiscount)
      `)
      .eq("route_id", jRow.route_id)
      .eq("is_active", true);
    if (rvaErr) throw rvaErr;

    // active vehicles w/ capacity fit
    const vehicles = (rvas ?? [])
      .filter((r: any) => r.vehicles?.active)
      .map((r: any) => ({
        vehicle_id: r.vehicles.id as string,
        name: r.vehicles.name as string,
        operator_id: r.vehicles.operator_id as string | null,
        minseats: Number(r.vehicles.minseats),
        maxseats: Number(r.vehicles.maxseats),
        minvalue: Number(r.vehicles.minvalue),
        preferred: !!r.preferred,
      }));

    // remove blacked-out
    const dep = new Date(depIso);
    const end = new Date(dep.getTime() + 2 * 60 * 60 * 1000); // assume a 2h window if no duration
    const filtered: typeof vehicles = [];
    for (const v of vehicles) {
      const { data: bl, error: blErr } = await sb
        .from("asset_blackouts")
        .select("start_ts,end_ts")
        .eq("vehicle_id", v.vehicle_id);
      if (blErr) throw blErr;
      const blocked = (bl ?? []).some((b) =>
        overlaps(new Date(b.start_ts), new Date(b.end_ts), dep, end)
      );
      if (!blocked && v.maxseats >= booked) filtered.push(v);
    }

    // choose best: preferred → lowest minvalue → smallest that fits
    filtered.sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
      if (a.minvalue !== b.minvalue) return a.minvalue - b.minvalue;
      return a.maxseats - b.maxseats;
    });

    let chosen = filtered[0];

    // T-window vehicle rules
    if (tHrs <= 24) {
      // T-24: vehicle must exist; do not auto-swap
      if (!jRow.vehicle_id && chosen) {
        // choose the smallest viable hull that ALSO meets minseats rule by T-24
        chosen =
          filtered.find((v) => v.minseats <= booked && booked <= v.maxseats) ?? chosen;
        await sb
          .from("journeys")
          .update({ vehicle_id: chosen.vehicle_id, operator_id: chosen.operator_id })
          .eq("id", journeyId);
      }
    } else if (tHrs <= 72) {
      // T-72..T-24: freeze if already assigned; if missing, assign one
      if (!jRow.vehicle_id && chosen) {
        await sb
          .from("journeys")
          .update({ vehicle_id: chosen.vehicle_id, operator_id: chosen.operator_id })
          .eq("id", journeyId);
      }
    } else {
      // >T-72: can (re)assign to best
      if (chosen && chosen.vehicle_id !== jRow.vehicle_id) {
        await sb
          .from("journeys")
          .update({ vehicle_id: chosen.vehicle_id, operator_id: chosen.operator_id })
          .eq("id", journeyId);
      }
    }

    // 3) Captain selection if missing
    // existing?
    const { data: existingLead } = await sb
      .from("journey_crew_assignments")
      .select("id,staff_id,role_code,status")
      .eq("journey_id", journeyId)
      .eq("role_code", "CAPTAIN")
      .maybeSingle();

    let captainPicked: any = existingLead ?? null;
    if (!captainPicked && chosen) {
      // eligible pool via vehicle_staff_prefs first
      const { data: prefs } = await sb
        .from("vehicle_staff_prefs")
        .select("staff_id, priority, is_lead_eligible, operator_id")
        .eq("vehicle_id", chosen.vehicle_id)
        .eq("operator_id", chosen.operator_id);

      let eligibleIds = (prefs ?? [])
        .filter((p: any) => p.is_lead_eligible !== false)
        .map((p: any) => ({ staff_id: p.staff_id as string, priority: p.priority as number }));

      if (eligibleIds.length === 0) {
        // fallback: operator captains
        const { data: caps } = await sb
          .from("operator_staff")
          .select("id, jobrole, active, operator_id")
          .eq("operator_id", chosen.operator_id)
          .eq("active", true);
        eligibleIds = (caps ?? [])
          .filter((c: any) => String(c.jobrole || "").toLowerCase().includes("capt"))
          .map((c: any) => ({ staff_id: c.id as string, priority: 3 }));
      }

      // availability & conflict filter
      const { data: conflicts } = await sb
        .from("journey_crew_assignments")
        .select("journey_id, staff_id")
        .in(
          "journey_id",
          [journeyId] // you can expand to same-day window if you store duration
        );

      const taken = new Set((conflicts ?? []).map((x: any) => x.staff_id));
      const eligible = eligibleIds.filter((e) => !taken.has(e.staff_id));

      // fair-use ordering (fewest recent)
      const ledgerCounts = new Map<string, number>();
      if (eligible.length > 0) {
        const { data: ledger } = await sb
          .from("captain_fairuse_ledger")
          .select("staff_id")
          .eq("operator_id", chosen.operator_id!);
        (ledger ?? []).forEach((r: any) => {
          ledgerCounts.set(r.staff_id, (ledgerCounts.get(r.staff_id) ?? 0) + 1);
        });
      }

      eligible.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const la = ledgerCounts.get(a.staff_id) ?? 0;
        const lb = ledgerCounts.get(b.staff_id) ?? 0;
        if (la !== lb) return la - lb;
        return a.staff_id.localeCompare(b.staff_id);
      });

      const winner = eligible[0];
      if (winner) {
        const ins = await sb
          .from("journey_crew_assignments")
          .insert({
            journey_id: journeyId,
            vehicle_id: chosen.vehicle_id,
            staff_id: winner.staff_id,
            role_code: "CAPTAIN",
            status: "assigned",
          })
          .select("id,staff_id")
          .single();
        if (!ins.error) {
          captainPicked = ins.data;
          await sb.from("captain_fairuse_ledger").insert({
            operator_id: chosen.operator_id,
            vehicle_id: chosen.vehicle_id,
            journey_id: journeyId,
            staff_id: winner.staff_id,
            confirmed: false,
          });
        }
      }
    }

    // 4) Final T-24 minseats guard (if now ≤24h)
    if (hoursUntil(depIso) <= 24) {
      const { data: j2 } = await sb.from("journeys").select("vehicle_id").eq("id", journeyId).single();
      if (j2?.vehicle_id) {
        const { data: v } = await sb.from("vehicles").select("minseats,maxseats").eq("id", j2.vehicle_id).single();
        if (v && booked < Number(v.minseats)) {
          // try a smaller viable hull
          const viable = filtered.filter((x) => x.minseats <= booked && booked <= x.maxseats);
          if (viable.length > 0) {
            const best = viable.sort((a, b) => a.maxseats - b.maxseats)[0];
            await sb.from("journeys").update({ vehicle_id: best.vehicle_id, operator_id: best.operator_id }).eq("id", journeyId);
          } else {
            // flag exception
            await sb.from("operator_journey_notices").insert({
              journey_id: journeyId,
              kind: "minseats_exception",
              operator_id: jRow.operator_id,
            });
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      journeyId,
      vehicleAssigned: chosen?.vehicle_id ?? jRow.vehicle_id ?? null,
      captainAssigned: captainPicked?.staff_id ?? null,
      booked,
      tWindowHours: tHrs,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
