import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Supabase (service role) */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = createClient(URL, SERVICE);

/* ---------------- Helpers ---------------- */

function parseBydayToIsoDows(byday: string): number[] {
  // RRULE BYDAY tokens -> ISO weekday 1..7 (Mon..Sun)
  const map: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
  return byday
    .split(",")
    .map((t) => map[t.trim().toUpperCase()])
    .filter((n): n is number => !!n);
}

// Fallback for human text like "Every Monday" or "Mon,Wed,Fri"
function parseTextToIsoDows(freq?: string | null): number[] {
  if (!freq) return [];
  const tokens = freq
    .replace(/every/gi, "")
    .replace(/\s+/g, "")
    .replace(/-/g, ",")
    .split(",")
    .filter(Boolean);

  const map: Record<string, number> = {
    MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
    MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7,
  };

  const out = new Set<number>();
  for (const t of tokens) {
    const k = t.toUpperCase();
    if (map[k]) out.add(map[k]);
  }
  return Array.from(out).sort();
}

function combineUtc(dateOnly: Date, timeHHMM?: string | null): Date {
  const [hhS, mmS, ssS] = (timeHHMM ?? "00:00:00").split(":");
  const hh = Number(hhS) || 0;
  const mm = Number(mmS) || 0;
  const ss = Number(ssS) || 0;
  return new Date(
    Date.UTC(
      dateOnly.getUTCFullYear(),
      dateOnly.getUTCMonth(),
      dateOnly.getUTCDate(),
      hh,
      mm,
      ss
    )
  );
}

function addMinutes(dt: Date, mins?: number | null): Date | null {
  if (mins == null) return null;
  const d = new Date(dt);
  d.setUTCMinutes(d.getUTCMinutes() + Number(mins));
  return d;
}

/* --------------- Handlers ---------------- */

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return generateDepartures(req, id, false);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return generateDepartures(req, id, true);
}

async function generateDepartures(req: NextRequest, routeId: string, doWrite: boolean) {
  if (!routeId) return NextResponse.json({ error: "Missing route id" }, { status: 400 });

  const { data: r, error } = await db
    .from("routes")
    .select(
      "id,frequency_rrule,frequency,pickup_time,approx_duration_mins,season_from,season_to"
    )
    .eq("id", routeId)
    .maybeSingle();

  if (error || !r) {
    return NextResponse.json({ error: error?.message || "Route not found" }, { status: 404 });
  }

  // Window (query overrides season)
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const startDate = new Date(fromParam ?? r.season_from ?? new Date());
  const endDate = new Date(
    toParam ?? r.season_to ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 120)
  );
  if (endDate < startDate) {
    return NextResponse.json({ error: "Invalid window" }, { status: 400 });
  }

  // Determine weekdays
  let dows: number[] = [];
  const m = /BYDAY=([A-Z,]+)/i.exec(r.frequency_rrule || "");
  if (m?.[1]) dows = parseBydayToIsoDows(m[1]);
  if (!dows.length) dows = parseTextToIsoDows(r.frequency);
  if (!dows.length) {
    return NextResponse.json(
      {
        error:
          "No BYDAY found. Use frequency_rrule (e.g. FREQ=WEEKLY;BYDAY=MO,FR) or frequency text (e.g. 'Mon,Wed,Fri').",
      },
      { status: 400 }
    );
  }

  // Walk the dates
  const out: { route_id: string; departure_ts: string; arrival_ts: string | null }[] = [];
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  );
  const endUTC = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  );

  while (cursor <= endUTC) {
    const isoDow = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay(); // Sun=7
    if (dows.includes(isoDow)) {
      const dep = combineUtc(cursor, r.pickup_time as any);
      const arr = addMinutes(dep, r.approx_duration_mins);
      out.push({
        route_id: r.id,
        departure_ts: dep.toISOString(),
        arrival_ts: arr ? arr.toISOString() : null,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (!doWrite) {
    return NextResponse.json({ ok: true, count: out.length, sample: out.slice(0, 5) });
  }

  // Idempotent upsert via unique (route_id, departure_ts)
  for (const rec of out) {
    await db.from("route_departures").upsert(
      {
        route_id: rec.route_id,
        departure_ts: rec.departure_ts,
        arrival_ts: rec.arrival_ts,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "route_id,departure_ts" }
    );
  }

  return NextResponse.json({ ok: true, created_or_existing: out.length });
}
