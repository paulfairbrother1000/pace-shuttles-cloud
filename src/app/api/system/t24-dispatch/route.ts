// src/app/api/system/t24-dispatch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sendEmail } from "@/lib/mailer";
import { operatorT24Html, clientT24Html } from "@/lib/email-templates";

type UUID = string;

const T24_SWEEP_MINUTES = Number(process.env.T24_SWEEP_MINUTES || 10); // cron step (e.g., */10)
const ARRIVE_EARLY_MINUTES = Number(process.env.CLIENT_ARRIVE_EARLY_MIN || 10); // "arrive by" = dep - 10m
const OPERATOR_TERMS_URL = process.env.OPERATOR_TERMS_URL || "https://yourdomain/legal/operator-terms";
const CLIENT_TERMS_URL = process.env.CLIENT_TERMS_URL || "https://yourdomain/legal/client-terms";

/** Create an authenticated Supabase server client bound to Next.js cookies. */
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

/** Utility: date window for "now + 24h" to "now + 24h + sweep" */
function t24Window() {
  const now = new Date();
  const from = new Date(now.getTime() + 24 * 3600 * 1000);
  const to = new Date(from.getTime() + T24_SWEEP_MINUTES * 60 * 1000);
  return { fromISO: from.toISOString(), toISO: to.toISOString(), from, to };
}

/** Format helpers */
function fmtDate(d: Date) {
  return d.toLocaleDateString();
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Heuristic label for vehicle type (adapt if you have a proper mapping) */
function vehicleTypeLabelFromHints(routeName?: string | null, typeId?: string | null) {
  const s = `${routeName || ""} ${typeId || ""}`.toLowerCase();
  if (s.includes("heli")) return "Helicopter";
  if (s.includes("bus") || s.includes("coach")) return "Bus";
  if (s.includes("limo") || s.includes("car")) return "Car";
  return "Boat";
}

/** Main POST handler: confirm leads at T-24 and send emails. */
export async function POST(_req: NextRequest) {
  const client = sb();
  try {
    const { fromISO, toISO } = t24Window();

    // 1) Find all lead assignments that are still "assigned" for journeys hitting T-24
    const { data: leads, error: leadErr } = await client
      .from("journey_assignments")
      .select(`
        id,
        journey_id,
        vehicle_id,
        staff_id,
        status,
        is_lead,
        ja:journeys!inner(
          id,
          route_id,
          operator_id,
          departure_ts
        )
      `)
      .eq("is_lead", true)
      .eq("status", "assigned")
      .gte("ja.departure_ts", fromISO)
      .lte("ja.departure_ts", toISO);

    if (leadErr) throw leadErr;

    // For each, flip to confirmed, write fair-use ledger, and email
    for (const a of leads ?? []) {
      const depISO = (a as any).ja.departure_ts as string;
      const dep = new Date(depISO);
      const journeyId = (a as any).ja.id as UUID;
      const operatorId = (a as any).ja.operator_id as UUID;
      const routeId = (a as any).ja.route_id as UUID;
      const vehicleId = a.vehicle_id as UUID;
      const staffId = a.staff_id as UUID;

      // 1a) Confirm lead
      const { error: upErr } = await client
        .from("journey_assignments")
        .update({
          status: "confirmed",
          status_simple: "confirmed",
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", a.id);
      if (upErr) throw upErr;

      // 1b) Write fair-use ledger (best-effort; ignore dup errors if constraint exists)
      await client.from("captain_fairuse_ledger").insert({
        operator_id: operatorId,
        vehicle_id: vehicleId,
        staff_id: staffId,
        journey_id: journeyId,
        assigned_at: new Date().toISOString(),
        confirmed: true,
      });

      // 1c) Gather data for emails
      const [
        { data: opRow },
        { data: staffRow },
        { data: vehRow },
        { data: routeRow },
      ] = await Promise.all([
        client.from("operators").select("admin_email").eq("id", operatorId).maybeSingle(),
        client.from("operator_staff").select("first_name,last_name,pronoun,photo_url").eq("id", staffId).maybeSingle(),
        client.from("vehicles").select("name,type_id,picture_url").eq("id", vehicleId).maybeSingle(),
        client.from("routes").select("route_name,name,pickup_id").eq("id", routeId).maybeSingle(),
      ]);

      const pickupId = routeRow?.pickup_id as UUID | null;
      const { data: pickupRow } = pickupId
        ? await client.from("pickup_points").select("name,arrival_notes").eq("id", pickupId).maybeSingle()
        : { data: null as any };

      // Pax total for this (journey, vehicle)
      const { data: paxRows } = await client
        .from("journey_vehicle_allocations")
        .select("seats")
        .eq("journey_id", journeyId)
        .eq("vehicle_id", vehicleId);
      const paxTotal = (paxRows || []).reduce((s: number, r: any) => s + Number(r.seats || 0), 0);

      // Orders (paid) for this route on this journey date
      const ymd = new Date(dep).toISOString().slice(0, 10);
      const { data: orders } = await client
        .from("orders")
        .select("lead_first_name,lead_last_name,lead_email,lead_phone,qty,status")
        .eq("route_id", routeId)
        .eq("journey_date", ymd)
        .eq("status", "paid");

      // Compose labels
      const journeyName = routeRow?.route_name || routeRow?.name || "Journey";
      const dateStr = fmtDate(dep);
      const timeStr = fmtTime(dep);
      const arriveBy = new Date(dep.getTime() - ARRIVE_EARLY_MINUTES * 60 * 1000);
      const arriveByStr = fmtTime(arriveBy);

      const vehicleTypeLabel = vehicleTypeLabelFromHints(journeyName, vehRow?.type_id || null);

      // 1d) Operator email (manifest)
      if (opRow?.admin_email) {
        const operatorHtml = operatorT24Html({
          route: {
            journeyName,
            dateStr,
            timeStr,
            pickupName: pickupRow?.name || "Pickup",
            pickupNotes: null,
          },
          vehicle: {
            typeLabel: vehicleTypeLabel,
            name: vehRow?.name || "Vehicle",
            photoUrl: vehRow?.picture_url || undefined,
          },
          paxTotal,
          revenueNet: null, // Optional: compute if you store net-of-commission
          captain: staffRow
            ? {
                first: staffRow.first_name || "Captain",
                last: staffRow.last_name || "",
                roleLabel: "Captain",
                pronoun: (staffRow.pronoun as any) || "they",
                photoUrl: staffRow.photo_url || undefined,
              }
            : null,
          crew: [], // If/when you add non-lead crew, include them here
          groups:
            (orders || []).map((o: any) => ({
              size: Number(o.qty || 0),
              leadName: `${o.lead_first_name ?? ""} ${o.lead_last_name ?? ""}`.trim() || "Lead",
              leadEmail: o.lead_email || null,
              leadPhone: o.lead_phone || null,
              guests: [] as string[], // fill if/when you capture guest names
            })) || [],
          termsUrl: OPERATOR_TERMS_URL,
        });

        await sendEmail({
          to: opRow.admin_email,
          subject: `${journeyName} manifest for ${dateStr}`,
          html: operatorHtml,
        });
      }

      // 1e) Client emails (one per paid order lead)
      for (const o of orders || []) {
        if (!o.lead_email) continue;
        const clientHtml = clientT24Html({
          leadFirst: o.lead_first_name || "there",
          route: {
            journeyName,
            dateStr,
            timeStr,
            pickupName: pickupRow?.name || "Pickup",
            pickupNotes: pickupRow?.arrival_notes || null,
            arriveByStr,
          },
          vehicle: {
            typeLabel: vehicleTypeLabel,
            name: vehRow?.name || "Vehicle",
            photoUrl: vehRow?.picture_url || undefined,
          },
          captain: staffRow
            ? {
                first: staffRow.first_name || "Captain",
                last: staffRow.last_name || "",
                roleLabel: "Captain",
                pronoun: (staffRow.pronoun as any) || "they",
                photoUrl: staffRow.photo_url || undefined,
              }
            : null,
          guestFirstNames: [], // fill if/when you capture guest names
          roleNoun: "Captain",
          clientTermsUrl: CLIENT_TERMS_URL,
        });

        await sendEmail({
          to: o.lead_email,
          subject: `Your ${journeyName} trip is tomorrow at ${timeStr}`,
          html: clientHtml,
        });
      }
    }

    // 2) For any journeys in the T-24 window that have NO lead at all → notify operator (unassigned)
    const { data: windowJourneys, error: jErr } = await client
      .from("journeys")
      .select("id, operator_id, route_id, departure_ts")
      .gte("departure_ts", fromISO)
      .lte("departure_ts", toISO)
      .eq("is_active", true);

    if (jErr) throw jErr;

    for (const j of windowJourneys || []) {
      // Does it have any assigned/confirmed lead?
      const { data: hasLead } = await client
        .from("journey_assignments")
        .select("id")
        .eq("journey_id", j.id)
        .eq("is_lead", true)
        .in("status", ["assigned", "confirmed"])
        .limit(1);

      if (hasLead && hasLead.length) continue;

      // Notify operator once per sweep (NOTE: without a dispatch log this will email every sweep)
      const { data: opRow } = await client
        .from("operators")
        .select("admin_email")
        .eq("id", j.operator_id)
        .maybeSingle();

      if (opRow?.admin_email) {
        const dateStr = fmtDate(new Date(j.departure_ts));
        const { data: routeRow } = await client
          .from("routes")
          .select("route_name,name")
          .eq("id", j.route_id)
          .maybeSingle();
        const journeyName = routeRow?.route_name || routeRow?.name || "Journey";

        const html = `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
            <p><strong>Captain Unassigned</strong> at T-24</p>
            <p>The journey <strong>${journeyName}</strong> for <strong>${dateStr}</strong> does not have a lead assigned.</p>
            <p>Please assign a captain from the Operator Admin page.</p>
          </div>
        `;
        await sendEmail({
          to: opRow.admin_email,
          subject: `Captain Unassigned — ${journeyName} (${dateStr})`,
          html,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      confirmed_count: (leads || []).length,
      window: { fromISO, toISO },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

/** GET wrapper so you can trigger via Vercel Cron (or hit from browser) */
export async function GET(req: NextRequest) {
  // Delegate to POST to keep logic in one place
  // @ts-ignore
  return POST(req);
}
