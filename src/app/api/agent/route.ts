// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * Chat API that uses the same SSOT as the homepage:
 * - /api/home-hydrate (global + per-country)
 * - /api/quote (live price; filters out zero/invalid)
 *
 * It provides three core intents without annoying clarifier loops:
 *  1) Countries we operate in (today)  → verified routes + upcoming occurrences
 *  2) Destinations we visit in <Country> → allowedDestIds from home-hydrate
 *  3) Journeys in <Country> [on <YYYY-MM-DD>] → occurrences + /api/quote
 *
 * Notes:
 * - No citations. Short, direct answers.
 * - Interprets questions as "today/current" unless the user explicitly asks for "roadmap/future".
 * - Filters out unit price £0 and non-available quote statuses.
 */

// ──────────────────────────────────────────────────────────────
// Small utils
// ──────────────────────────────────────────────────────────────
function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";
  return `${proto}://${host}`;
}

async function fetchJSON<T>(path: string): Promise<T> {
  const base = getBaseUrl();
  const res = await fetch(`${base}${path}`, { cache: "no-store", headers: { accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${path}: ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function startOfMonth(d: Date) { const x = new Date(d.getFullYear(), d.getMonth(), 1); x.setHours(12,0,0,0); return x; }
function endOfMonth(d: Date) { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(12,0,0,0); return x; }
function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) { const f = new Date(from + "T12:00:00").getTime(); if (t < f) return false; }
  if (to)   { const tt = new Date(to + "T12:00:00").getTime(); if (t > tt) return false; }
  return true;
}

type Freq = { type: "WEEKLY"; weekday: number } | { type: "DAILY" } | { type: "ADHOC" };
function parseFrequency(freq: string | null | undefined): Freq {
  if (!freq) return { type: "ADHOC" };
  const s = (freq || "").toLowerCase().trim();
  if (s.includes("daily")) return { type: "DAILY" };
  const weekdayIdx = DAY_NAMES.findIndex((d) => s.includes(d.toLowerCase()));
  if (weekdayIdx >= 0) return { type: "WEEKLY", weekday: weekdayIdx };
  return { type: "ADHOC" };
}

function formatLocalISO(d: Date, timeZone?: string | null): string {
  const tz = (timeZone && timeZone.trim()) || "UTC";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value ?? "1970";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const dd = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${dd}`;
}

function hhmmLocalToDisplay(hhmm: string | null | undefined) {
  if (!hhmm) return "—";
  try {
    const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return hhmm || "—"; }
}

function currencyIntPounds(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "£0";
  return `£${Math.ceil(n).toLocaleString("en-GB")}`;
}

function findISOInText(text: string): string | null {
  const m = String(text).match(/\b\d{4}-\d{2}-\d{2}\b/);
  return m ? m[0] : null;
}
function guessCountryName(q: string): string | null {
  // naive: take proper-noun-like chunk after "in " or "for "
  const m = q.match(/\b(?:in|for)\s+([A-Z][A-Za-z &'().-]+)(?:\?|$|\.|,)/);
  return m ? m[1].trim() : null;
}

// ──────────────────────────────────────────────────────────────
// Types (mirror homepage contracts)
// ──────────────────────────────────────────────────────────────
type Country = { id: string; name: string; description?: string | null; picture_url?: string | null; timezone?: string | null };
type Destination = { id: string; name: string; country_id: string | null; town?: string | null; region?: string | null; picture_url?: string | null; description?: string | null };
type Pickup = { id: string; name: string; country_id: string; picture_url?: string | null; description?: string | null };

type RouteRow = {
  id: string;
  route_name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  pickup_time: string | null;       // "HH:mm"
  frequency: string | null;         // "Every Tuesday", "Daily", "Ad-hoc"
  frequency_rrule?: string | null;
  season_from?: string | null;      // YYYY-MM-DD
  season_to?: string | null;        // YYYY-MM-DD
  is_active?: boolean | null;
  transport_type?: string | null;
  countries?: { id: string; name: string; timezone?: string | null } | null;
};

type Assignment = { id: string; route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null; };
type Vehicle = {
  id: string;
  name: string;
  operator_id?: string | null;
  type_id?: string | null;
  active?: boolean | null;
  minseats?: number | null;
  minvalue?: number | null;
  maxseatdiscount?: number | null;
  maxseats?: number | string | null;
};

type HydrateGlobal = {
  countries: Country[];
  available_destinations_by_country: Record<string, string[]>;
};
type HydrateCountry = {
  pickups: Pickup[];
  destinations: Destination[];
  routes: RouteRow[];
  assignments: Assignment[];
  vehicles: Vehicle[];
  sold_out_keys: string[];
  remaining_by_key_db: Record<string, number>;
};

// ──────────────────────────────────────────────────────────────
const MIN_LEAD_HOURS = 25;
const DIAG = process.env.NODE_ENV !== "production" ? "1" : "0";

async function fetchQuote(routeId: string, dateISO: string, qty = 1, vehicleId?: string | null) {
  const sp = new URLSearchParams({
    route_id: routeId,
    date: dateISO,
    qty: String(Math.max(1, qty)),
    diag: DIAG,
  });
  if (vehicleId) sp.set("vehicle_id", vehicleId);

  const base = getBaseUrl();
  const res = await fetch(`${base}/api/quote?${sp.toString()}`, { method: "GET", cache: "no-store" });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { return { ok: false, reason: "non_json" as const }; }

  if (json && !json.error_code) {
    const unitMinor =
      (json.unit_cents ?? null) != null
        ? Number(json.unit_cents)
        : Math.round(Number(json.total_cents ?? 0) / Math.max(1, Number(json.qty || 1)));

    if (json.availability === "available" && unitMinor > 0) {
      return {
        ok: true as const,
        unitGBP: Math.ceil(unitMinor / 100),
        currency: json.currency ?? "GBP",
        token: json.token,
        vehicle_id: json.vehicle_id ?? null,
      };
    }
    return { ok: false as const, reason: "unavailable" as const };
  }
  return { ok: false as const, reason: json?.error_code ? String(json.error_code) : "unknown" };
}

function computeOccurrences(verifiedRoutes: RouteRow[]) {
  const nowPlus = addDays(new Date(), 0);
  nowPlus.setHours(nowPlus.getHours() + MIN_LEAD_HOURS);
  const today = startOfDay(new Date());
  const windowStart = startOfMonth(today);
  const windowEnd = endOfMonth(addMonths(today, 5));

  type Occurrence = { route_id: string; dateISO: string };
  const out: Occurrence[] = [];

  for (const r of verifiedRoutes) {
    const kind = parseFrequency(r.frequency);
    if (kind.type === "WEEKLY") {
      const s = new Date(windowStart);
      const diff = (kind.weekday - s.getDay() + 7) % 7;
      s.setDate(s.getDate() + diff);
      for (let d = new Date(s); d <= windowEnd; d = addDays(d, 7)) {
        if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
        if (d.getTime() < startOfDay(nowPlus).getTime()) continue;
        const iso = formatLocalISO(d, r.countries?.timezone);
        out.push({ route_id: r.id, dateISO: iso });
      }
    } else if (kind.type === "DAILY") {
      for (let d = new Date(windowStart); d <= windowEnd; d = addDays(d, 1)) {
        if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
        if (d.getTime() < startOfDay(nowPlus).getTime()) continue;
        const iso = formatLocalISO(d, r.countries?.timezone);
        out.push({ route_id: r.id, dateISO: iso });
      }
    } else {
      if (withinSeason(today, r.season_from ?? null, r.season_to ?? null)) {
        const d = new Date(today);
        if (d.getTime() >= startOfDay(nowPlus).getTime()) {
          const iso = formatLocalISO(d, r.countries?.timezone);
          out.push({ route_id: r.id, dateISO: iso });
        }
      }
    }
  }
  return out;
}

function buildVerifiedRoutes(data: HydrateCountry) {
  // Active vehicles with capacity
  const activeVehicleIds = new Set(
    data.vehicles
      .filter((v) => v && v.active !== false && Number(v.maxseats ?? 0) > 0)
      .map((v) => v.id)
  );

  // Routes that have at least one active assignment to an active vehicle
  const routesWithActiveVehicle = new Set(
    data.assignments
      .filter((a) => a.is_active !== false && activeVehicleIds.has(a.vehicle_id))
      .map((a) => a.route_id)
  );

  return data.routes.filter((r) => routesWithActiveVehicle.has(r.id));
}

// ──────────────────────────────────────────────────────────────
// Intent detection (lean; no loops)
// ──────────────────────────────────────────────────────────────
function detectIntent(q: string) {
  const s = q.toLowerCase();
  const wantsCountryList =
    /(which|what)\s+countries\b|countries\s+(do you|d’you)?\s*(operate|serve)|\boperate in which countries\b/.test(s);
  const wantsDestinations =
    /(?:what|which)\s+(destinations|places)\b.*\b(in|at)\b|\bdestinations?\s+in\b/.test(s);
  const wantsJourneys =
    /(?:what|which)\s+(journeys|trips|routes)\b|\bshow\s+journeys\b|\bbook\b.*\bjourney\b/.test(s);
  const roadmap =
    /\b(road\s*map|roadmap|future|next|coming|planned|expanding)\b/.test(s);
  const countryHint = guessCountryName(q);
  const isoDate = findISOInText(q);

  return { wantsCountryList, wantsDestinations, wantsJourneys, roadmap, countryHint, isoDate };
}

// ──────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const q = String(body?.message || body?.text || "").trim();
  if (!q) return NextResponse.json({ content: "Please enter a question." });

  const intent = detectIntent(q);

  try {
    // 1) Global hydrate
    const global = await fetchJSON<HydrateGlobal>("/api/home-hydrate");

    // Helper to resolve country object from name hint
    const findCountry = (name?: string | null): Country | null => {
      if (!name) return null;
      const n = name.trim().toLowerCase();
      return (
        global.countries.find(
          (c) => c.name.trim().toLowerCase() === n ||
                 c.name.trim().toLowerCase().includes(n)
        ) || null
      );
    };

    // If they ask for roadmap, we *do not* list it unless you want to surface inactive plans.
    // Per your latest direction: "current" means countries with verified routes + upcoming occurrences.
    if (intent.wantsCountryList && !intent.roadmap) {
      // Determine which countries are *operating today*: have verified routes with upcoming occurrences.
      const operatingNames: string[] = [];

      for (const c of global.countries) {
        // Pull per-country hydrate
        const data = await fetchJSON<HydrateCountry>(`/api/home-hydrate?country_id=${encodeURIComponent(c.id)}`);
        const verifiedRoutes = buildVerifiedRoutes(data);
        if (verifiedRoutes.length === 0) continue;

        const occ = computeOccurrences(verifiedRoutes);
        if (occ.length > 0) operatingNames.push(c.name);
      }

      if (operatingNames.length === 0) {
        return NextResponse.json({
          content: "We don’t have any bookable journeys today. Please check back soon."
        });
      }

      const list = operatingNames.map((n) => `• ${n}`).join("\n");
      return NextResponse.json({
        content: `Pace Shuttles currently operates in:\n\n${list}\n\nAsk for destinations in any of these, e.g. “What destinations do you visit in Antigua?”`
      });
    }

    // 2) Destinations in a country
    if (intent.wantsDestinations) {
      const country = findCountry(intent.countryHint) || null;
      if (!country) {
        return NextResponse.json({
          content: "Please tell me the country (e.g., “What destinations do you visit in Antigua?”)."
        });
      }

      const data = await fetchJSON<HydrateCountry>(`/api/home-hydrate?country_id=${encodeURIComponent(country.id)}`);
      const allowed = new Set(global.available_destinations_by_country[country.id] ?? []);
      const list = (data.destinations || []).filter(d => allowed.has(d.id));

      if (list.length === 0) {
        return NextResponse.json({
          content: `We don’t have bookable destinations in ${country.name} right now.`
        });
      }

      // Show name + general locality if available
      const lines = list.map((d) => {
        const locality = [d.town, d.region].filter(Boolean).join(", ");
        return locality ? `• ${d.name} — ${locality}` : `• ${d.name}`;
      }).join("\n");

      return NextResponse.json({
        content: `We currently visit the following destinations in ${country.name}:\n\n${lines}\n\nYou can ask “Show journeys in ${country.name} on YYYY-MM-DD” to see live options.`
      });
    }

    // 3) Journeys in a country (optionally on a specific date)
    if (intent.wantsJourneys || intent.countryHint) {
      const country = findCountry(intent.countryHint) || null;
      if (!country) {
        return NextResponse.json({
          content: "Please tell me the country (e.g., “Show journeys in Antigua on 2025-11-20”)."
        });
      }

      const data = await fetchJSON<HydrateCountry>(`/api/home-hydrate?country_id=${encodeURIComponent(country.id)}`);
      const verifiedRoutes = buildVerifiedRoutes(data);
      if (verifiedRoutes.length === 0) {
        return NextResponse.json({ content: `No verified routes in ${country.name} yet.` });
      }

      const occAll = computeOccurrences(verifiedRoutes);
      if (occAll.length === 0) {
        return NextResponse.json({ content: `No upcoming departures in ${country.name} right now.` });
      }

      // Optional date lock (YYYY-MM-DD). If provided, filter to that date.
      const iso = intent.isoDate;
      const occ = iso ? occAll.filter(o => o.dateISO === iso) : occAll;

      // Fetch quotes for first N occurrences (avoid spam)
      const MAX = 12;
      const sample = occ.slice(0, MAX);

      // Build lookup maps for names
      const pickupById = new Map((data.pickups || []).map(p => [p.id, p]));
      const destById = new Map((data.destinations || []).map(d => [d.id, d]));
      const routeMap = new Map(verifiedRoutes.map(r => [r.id, r]));

      const rows: string[] = [];
      for (const o of sample) {
        const r = routeMap.get(o.route_id);
        if (!r) continue;

        const quote = await fetchQuote(r.id, o.dateISO, 1, null);
        if (!quote.ok) continue; // skip unavailable / zero / errors

        const pu = r.pickup_id ? pickupById.get(r.pickup_id) : null;
        const de = r.destination_id ? destById.get(r.destination_id) : null;

        const name = `${pu?.name ?? "—"} → ${de?.name ?? "—"}`;
        const dateStr = new Date(o.dateISO + "T12:00:00").toLocaleDateString();
        const timeStr = hhmmLocalToDisplay(r.pickup_time);
        const mins = r.approx_duration_mins ?? undefined;

        rows.push(`• ${name} — ${dateStr}, ${timeStr}${mins ? `, ${mins} min` : ""}, from ${currencyIntPounds(quote.unitGBP)}`);
      }

      if (rows.length === 0) {
        return NextResponse.json({
          content: iso
            ? `No bookable journeys found in ${country.name} on ${iso}.`
            : `No bookable journeys surfaced just now in ${country.name}. Try another date.`
        });
      }

      const header = iso ? `Journeys in ${country.name} on ${iso}:` : `Next available journeys in ${country.name}:`;
      return NextResponse.json({ content: `${header}\n\n${rows.join("\n")}\n\nSay “show more” with a date if you want additional options.` });
    }

    // Default fallback: brief help
    return NextResponse.json({
      content:
        "I can help with countries, destinations, and journeys.\n\n• “What countries do you operate in?”\n• “What destinations do you visit in Antigua?”\n• “Show journeys in Barbados on 2025-11-20”"
    });
  } catch (e: any) {
    return NextResponse.json({
      content: e?.message || "Something went wrong reaching live data."
    });
  }
}
