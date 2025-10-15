// src/app/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { TilePicker } from "../components/TilePicker";
import { JourneyCard } from "../components/JourneyCard";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Greedy allocator + live-quote fetch ---------- */
type Party = { size: number };

function allocatePartiesForRemaining(
  parties: Party[],
  boats: { vehicle_id: string; cap: number; preferred: boolean }[]
) {
  const groups = [...parties].filter(g => g.size > 0).sort((a, b) => b.size - a.size);
  const state = boats.map(b => ({
    id: b.vehicle_id,
    cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
    used: 0,
    preferred: !!b.preferred,
  }));
  for (const g of groups) {
    const candidates = state
      .map(s => ({ ref: s, free: s.cap - s.used, preferred: s.preferred }))
      .filter(c => c.free >= g.size)
      .sort((a, b) =>
        a.preferred === b.preferred ? a.free - b.free : (a.preferred ? -1 : 1)
      );
    if (!candidates.length) continue;
    candidates[0].ref.used += g.size;
  }
  const used = state.reduce((s, x) => s + x.used, 0);
  const cap  = state.reduce((s, x) => s + x.cap, 0);
  return { remaining: Math.max(0, cap - used) };
}

const DIAG = process.env.NODE_ENV !== "production" ? "1" : "0";

async function fetchQuoteOnce(
  routeId: string,
  dateISO: string,
  qty: number,
  signal?: AbortSignal,
  vehicleId?: string | null
): Promise<QuoteOk | QuoteErr> {
  const sp = new URLSearchParams({
    route_id: routeId,
    date: dateISO.slice(0, 10),
    qty: String(Math.max(1, qty)),
    diag: DIAG,
  });
  if (vehicleId) sp.set("vehicle_id", vehicleId);

  const res = await fetch(`/api/quote?${sp.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const txt = await res.text();
  try {
    return JSON.parse(txt) as QuoteOk;
  } catch {
    return { error_code: `non_json_${res.status}`, details: txt.slice(0, 160) };
  }
}

// --- unified fetch helper for server-hydrate endpoints ---
async function fetchJSON<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} from ${input}: ${snippet}`);
  }
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Non-JSON from ${input}: ${txt.slice(0, 200)}`);
  }
}

// Browser-only Supabase client (safe no-op on the server)
const supabase = (() => {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anon ? createBrowserClient(url, anon) : null;
})();

const LOGIN_PATH = "/login";
const HERO_IMG_URL = "/pace-hero.jpg";
const FOOTER_CTA_IMG_URL = "/partners-cta.jpg";

/* ---------- Tiny banner component for warnings ---------- */
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      {children}
    </div>
  );
}

/* ---------- Image URL normalizer (for Supabase public storage) ---------- */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  // If it's already an absolute URL...
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal =
        u.hostname === "localhost" ||
        /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(u.hostname);

      // If it's already pointing at a public object path, normalize it to our host and add cache-busting
      const publicPrefix = "/storage/v1/object/public/";
      if (u.pathname.startsWith(publicPrefix)) {
        const rest = u.pathname.slice(publicPrefix.length); // everything after the prefix
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}${publicPrefix}${rest}?v=5`
          : `${raw}?v=5`;
      }
      return raw; // some other external URL
    } catch {
      return undefined;
    }
  }

  // If it's a public storage path (no origin)
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }

  // Otherwise treat it as a bucket key like "images/foo.jpg" or "foo.jpg"
  const key = raw.replace(/^\/+/, "");
  const normalizedKey = key.startsWith(`${bucket}/`) ? key : `${bucket}/${key}`;
  return `https://${supaHost}/storage/v1/object/public/${normalizedKey}?v=5`;
}

function typeImgSrc(t: { picture_url?: string | null }) {
  return publicImage(t.picture_url);
}

/* ---------- Date/format helpers ---------- */
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const MAX_ROWS = 10;
const MIN_LEAD_HOURS = 25;

function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addHours(d: Date, n: number) { const x = new Date(d); x.setHours(x.getHours() + n); return x; }
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

function formatLocalISO(d: Date, timeZone?: string | null): string {
  const tz = (timeZone && timeZone.trim()) || "UTC";
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value ?? "1970";
  const m = parts.find(p => p.type === "month")?.value ?? "01";
  const dd = parts.find(p => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${dd}`;
}

function makeDepartureISO(dateISO: string, pickup_time: string | null | undefined): string | null {
  if (!dateISO || !pickup_time) return null;
  try { return new Date(`${dateISO}T${pickup_time}:00`).toISOString(); } catch { return null; }
}

/* ---------- Types hydrated from the server ---------- */
type Country = { id: string; name: string; description?: string | null; picture_url?: string | null };
type Pickup = { id: string; name: string; country_id: string; picture_url?: string | null; description?: string | null };
type Destination = { id: string; name: string; country_id: string | null; picture_url?: string | null; description?: string | null; url?: string | null };

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
type TransportTypeRow = { id: string; name: string; description?: string | null; picture_url?: string | null; is_active?: boolean | null };

type Order = { id: string; status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired"; route_id: string | null; journey_date: string | null; qty: number | null };

type UiQuote = {
  displayPounds: number;
  token: string;
  availability?: "available" | "sold_out" | "no_journey" | "no_vehicles" | "insufficient_capacity_for_party";
  currency?: string;
  vehicle_id?: string | null;
  max_qty_at_price?: number | null;
};

type QuoteOk = {
  availability: "available" | "no_journey" | "no_vehicles" | "sold_out" | "insufficient_capacity_for_party";
  qty: number;
  base_cents: number;
  tax_cents: number;
  fees_cents: number;
  total_cents: number;
  unit_cents?: number;
  perSeatAllInC?: number;
  currency?: string;
  vehicle_id?: string | null;
  max_qty_at_price?: number | null;
  token: string;
};
type QuoteErr = { error_code: string; step?: string; details?: string };

/* ---------- Server-hydrate payload contracts ---------- */
type HydrateGlobal = {
  countries: Country[];
  available_destinations_by_country: Record<string, string[]>;
};

type HydrateCountry = {
  pickups: Pickup[];
  destinations: Destination[];
  routes: RouteRow[];
  transport_types: TransportTypeRow[];
  assignments: Assignment[];
  vehicles: Vehicle[];
  orders: Order[];
  sold_out_keys: string[];                      // `${route_id}_${ymd}`
  remaining_by_key_db: Record<string, number>;  // `${route_id}_${ymd}` -> remaining
};

export default function Page() {
  {/* === Pace Shuttles Theme Block v1 (scoped to this page) === */}
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style jsx global>{`
        /* Scope to .ps-theme so we can roll out gradually */
        .ps-theme {
          --bg:             #0f1a2a;  /* page background */
          --card:           #15243a;  /* tiles/tables */
          --border:         #20334d;  /* subtle borders */
          --text:           #eaf2ff;  /* primary text */
          --muted:          #a3b3cc;  /* secondary text */
          --accent:         #2a6cd6;  /* links/pills/buttons */
          --accent-contrast:#ffffff;  /* text on accent */
          --radius:         14px;     /* radii for tiles/buttons */
          --shadow:         0 6px 20px rgba(0,0,0,0.25);

          color: var(--text);
          background: var(--bg);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji";
        }
        .bg-app   { background: var(--bg); }
        .bg-card  { background: var(--card); }
        .text-app { color: var(--text); }
        .text-muted { color: var(--muted); }
        .ring-app { box-shadow: 0 0 0 1px var(--border) inset; }
        .shadow-app { box-shadow: var(--shadow); }
        .tile { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); }
        .tile-border { box-shadow: 0 0 0 1px var(--border) inset; }
        .pill { border-radius: 9999px; padding: .375rem .75rem; font-size: .85rem; border: 1px solid var(--border); background: transparent; color: var(--text); }
        .pill-active { background: var(--accent); color: var(--accent-contrast); border-color: transparent; }
        .pill-idle:hover { background: rgba(255,255,255,.06); }
        .btn { border-radius: var(--radius); padding: .625rem .9rem; border: 1px solid var(--border); background: var(--card); color: var(--text); }
        .btn:hover { filter: brightness(1.05); }
        .btn-primary { background: var(--accent); color: var(--accent-contrast); border-color: transparent; }
        a { color: var(--text); text-decoration: none; }
        a:hover { color: var(--accent); }
        .heading { font-weight: 700; letter-spacing: .2px; }
        .subtle-border { box-shadow: 0 0 0 1px var(--border) inset; }
        .no-scrollbar::-webkit-scrollbar{display:none;} .no-scrollbar{ -ms-overflow-style:none; scrollbar-width:none; }

        /* Tables */
        table.ps { width: 100%; border-collapse: separate; border-spacing: 0; }
        table.ps thead { background: rgba(255,255,255,0.04); }
        table.ps th, table.ps td { padding: .75rem; border-bottom: 1px solid var(--border); }
      `}</style>

      {/* ===== SECTION 1: State + hydrate loader ===== */}
      {(() => {
        const DEFAULT_SEATS = 2;

        const [hydrated, setHydrated] = useState(false);
        const [loading, setLoading] = useState(true);
        const [msg, setMsg] = useState<string | null>(null);

        const [countryId, setCountryId] = useState<string>("");
        const [activePane, setActivePane] =
          useState<"none" | "date" | "destination" | "pickup" | "type">("none");

        const [filterDateISO, setFilterDateISO] = useState<string | null>(null);
        const [filterDestinationId, setFilterDestinationId] = useState<string | null>(null);
        const [filterPickupId, setFilterPickupId] = useState<string | null>(null);
        const [filterTypeName, setFilterTypeName] = useState<string | null>(null);

        const [calCursor, setCalCursor] = useState<Date>(startOfMonth(new Date()));

        const [countries, setCountries] = useState<Country[]>([]);
        const [pickups, setPickups] = useState<Pickup[]>([]);
        const [destinations, setDestinations] = useState<Destination[]>([]);
        const [routes, setRoutes] = useState<RouteRow[]>([]);
        const [transportTypeRows, setTransportTypeRows] = useState<TransportTypeRow[]>([]);
        const [assignments, setAssignments] = useState<Assignment[]>([]);
        const [vehicles, setVehicles] = useState<Vehicle[]>([]);
        const [orders, setOrders] = useState<Order[]>([]);
        const [soldOutKeys, setSoldOutKeys] = useState<string[]>([]);
        const [remainingByKeyDB, setRemainingByKeyDB] = useState<Record<string, number>>({});

        const [availableDestinationsByCountry, setAvailableDestinationsByCountry] =
          useState<Record<string, string[]>>({});

        const normType = (s: string) => s.trim().toLowerCase();
        const titleCase = (s: string) =>
          s.replace(/\s+/g, " ")
            .split(" ")
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
            .join(" ");

        const transportTypesById = useMemo(() => {
          const m: Record<string, string> = {};
          for (const t of transportTypeRows) m[String(t.id)] = t.name;
          return m;
        }, [transportTypeRows]);

        const transportTypesByName = useMemo(() => {
          const m: Record<string, string> = {};
          for (const t of transportTypeRows) m[t.name.toLowerCase()] = t.name;
          return m;
        }, [transportTypeRows]);

        const transportTypeByNormName = useMemo(() => {
          const m: Record<string, TransportTypeRow> = {};
          for (const t of transportTypeRows) m[normType(t.name)] = t;
          return m;
        }, [transportTypeRows]);

        useEffect(() => {
          let cancelled = false;
          (async () => {
            try {
              setLoading(true);
              const g = await fetchJSON<HydrateGlobal>("/api/home-hydrate");
              if (cancelled) return;
              setCountries(g.countries ?? []);
              setAvailableDestinationsByCountry(g.available_destinations_by_country ?? {});
              setMsg(null);
              setHydrated(true);
            } catch (e: any) {
              if (!cancelled) setMsg(e?.message ?? "Failed to load");
            } finally {
              if (!cancelled) setLoading(false);
            }
          })();
          return () => { cancelled = true; };
        }, []);

        useEffect(() => {
          if (!countryId) {
            setPickups([]); setDestinations([]); setRoutes([]);
            setTransportTypeRows([]); setAssignments([]); setVehicles([]);
            setOrders([]); setSoldOutKeys([]); setRemainingByKeyDB({});
            return;
          }

          let cancelled = false;
          (async () => {
            try {
              setLoading(true);
              const data = await fetchJSON<HydrateCountry>(`/api/home-hydrate?country_id=${encodeURIComponent(countryId)}`);
              if (cancelled) return;
              setPickups(data.pickups ?? []);
              setDestinations(data.destinations ?? []);
              setRoutes(data.routes ?? []);
              setTransportTypeRows(data.transport_types ?? []);
              setAssignments(data.assignments ?? []);
              setVehicles(data.vehicles ?? []);
              setOrders(data.orders ?? []);
              setSoldOutKeys(data.sold_out_keys ?? []);
              setRemainingByKeyDB(data.remaining_by_key_db ?? {});
              setMsg(null);
            } catch (e: any) {
              if (!cancelled) setMsg(e?.message ?? "Failed to load country data");
            } finally {
              if (!cancelled) setLoading(false);
            }
          })();

          return () => { cancelled = true; };
        }, [countryId]);

        // ===== SECTION 3: Derived data, pricing, handlers, calendar helpers =====
        const verifiedRoutes = useMemo(() => {
          const withAsn = new Set(assignments.filter(a => a.is_active !== false).map((a) => a.route_id));
          return routes.filter((r) => withAsn.has(r.id));
        }, [routes, assignments]);

        type Occurrence = { id: string; route_id: string; dateISO: string };
        const occurrences: Occurrence[] = useMemo(() => {
          const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
          const today = startOfDay(new Date());
          const windowStart = startOfMonth(today);
          const windowEnd = endOfMonth(addMonths(today, 5));
          const out: Occurrence[] = [];

          for (const r of verifiedRoutes) {
            const kind = parseFrequency(r.frequency);
            if (kind.type === "WEEKLY") {
              const s = new Date(windowStart);
              const diff = (kind.weekday - s.getDay() + 7) % 7;
              s.setDate(s.getDate() + diff);
              for (let d = new Date(s); d <= windowEnd; d = addDays(d, 7)) {
                if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
                if (d.getTime() < startOfDay(nowPlus25h).getTime()) continue;
                const iso = formatLocalISO(d, r.countries?.timezone);
                out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
              }
            } else if (kind.type === "DAILY") {
              for (let d = new Date(windowStart); d <= windowEnd; d = addDays(d, 1)) {
                if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
                if (d.getTime() < startOfDay(nowPlus25h).getTime()) continue;
                const iso = formatLocalISO(d, r.countries?.timezone);
                out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
              }
            } else {
              if (withinSeason(today, r.season_from ?? null, r.season_to ?? null)) {
                const d = new Date(today);
                if (d.getTime() >= startOfDay(nowPlus25h).getTime()) {
                  const iso = formatLocalISO(d, r.countries?.timezone);
                  out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
                }
              }
            }
          }
          return out;
        }, [verifiedRoutes]);

        const pickupById = (id: string | null | undefined) => pickups.find((p) => p.id === id) || null;
        const destById   = (id: string | null | undefined) => destinations.find((d) => d.id === id) || null;

        const routeMap = useMemo(() => {
          const m = new Map<string, RouteRow>();
          verifiedRoutes.forEach((r) => m.set(r.id, r));
          return m;
        }, [verifiedRoutes]);

        const vehicleTypeNameForRoute = (routeId: string): string => {
          const vs = assignments
            .filter((a) => a.route_id === routeId && a.is_active !== false)
            .map((a) => vehicles.find((v) => v && v.id === a.vehicle_id && v.active !== false))
            .filter(Boolean) as Vehicle[];
          if (vs.length && vs[0]?.type_id) {
            const mapped = transportTypesById[String(vs[0].type_id)];
            if (mapped) return mapped;
          }
          const r = routeMap.get(routeId);
          if (r?.transport_type) {
            const raw = r.transport_type;
            if (transportTypesById[raw]) return transportTypesById[raw];
            const viaName = transportTypesByName[raw.toLowerCase()];
            if (viaName) return viaName;
            return raw;
          }
          return "—";
        };

        const boatsByRoute = useMemo(() => {
          const m = new Map<string, { vehicle_id: string; cap: number; preferred: boolean }[]>();
          for (const a of assignments) {
            if (a.is_active === false) continue;
            const v = vehicles.find(x => x.id === a.vehicle_id && x.active !== false);
            if (!v) continue;
            const cap = Number(v.maxseats ?? 0);
            const arr = m.get(a.route_id) ?? [];
            arr.push({ vehicle_id: a.vehicle_id, cap: Number.isFinite(cap) ? cap : 0, preferred: !!a.preferred });
            m.set(a.route_id, arr);
          }
          return m;
        }, [assignments, vehicles]);

        const partiesByKey = useMemo(() => {
          const m = new Map<string, Party[]>();
          for (const o of orders) {
            if (o.status !== "paid" || !o.route_id || !o.journey_date) continue;
            const k = `${o.route_id}_${o.journey_date}`;
            const arr = m.get(k) ?? [];
            const size = Math.max(0, Number(o.qty ?? 0));
            if (size > 0) arr.push({ size });
            m.set(k, arr);
          }
          return m;
        }, [orders]);

        const remainingSeatsByKey = useMemo(() => {
          const m = new Map<string, number>();
          for (const occ of occurrences) {
            const boats = boatsByRoute.get(occ.route_id) ?? [];
            if (!boats.length) { m.set(`${occ.route_id}_${occ.dateISO}`, 0); continue; }
            const parties = partiesByKey.get(`${occ.route_id}_${occ.dateISO}`) ?? [];
            const { remaining } = allocatePartiesForRemaining(parties, boats);
            m.set(`${occ.route_id}_${occ.dateISO}`, remaining);
          }
          return m;
        }, [occurrences, boatsByRoute, partiesByKey]);

        function isSoldOut(routeId: string, dateISO: string) {
          const k = `${routeId}_${dateISO}`;
          const dbRem = (remainingByKeyDB as Record<string, number>)[k];
          if (dbRem != null) return dbRem <= 0;
          return (remainingSeatsByKey.get(k) ?? 0) <= 0;
        }

        const occWithFilters = useMemo(() => {
          const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
          const minISO = startOfDay(nowPlus25h).toISOString().slice(0, 10);
          return occurrences.filter((o) => o.dateISO >= minISO);
        }, [occurrences]);

        const facetDestIds = useMemo(() => {
          let occ = occWithFilters;
          if (filterDateISO) occ = occ.filter((o) => o.dateISO === filterDateISO);
          if (filterPickupId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.pickup_id === filterPickupId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          if (filterTypeName) {
            const keep = new Set(
              verifiedRoutes
                .filter((r) => normType(vehicleTypeNameForRoute(r.id)) === filterTypeName)
                .map((r) => r.id)
            );
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          occ = occ.filter((o) => !isSoldOut(o.route_id, o.dateISO));

          const destIds = new Set<string>();
          for (const o of occ) {
            const r = routeMap.get(o.route_id);
            if (!r?.destination_id) continue;
            destIds.add(r.destination_id);
          }
          return destIds;
        }, [occWithFilters, filterDateISO, filterPickupId, filterTypeName, verifiedRoutes, routeMap]);

        const facetPickupIds = useMemo(() => {
          let occ = occWithFilters;
          if (filterDateISO) occ = occ.filter((o) => o.dateISO === filterDateISO);
          if (filterDestinationId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.destination_id === filterDestinationId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          if (filterTypeName) {
            const keep = new Set(
              verifiedRoutes
                .filter((r) => normType(vehicleTypeNameForRoute(r.id)) === filterTypeName)
                .map((r) => r.id)
            );
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          occ = occ.filter((o) => !isSoldOut(o.route_id, o.dateISO));

          const pickupIds = new Set<string>();
          for (const o of occ) {
            const r = routeMap.get(o.route_id);
            if (!r?.pickup_id) continue;
            pickupIds.add(r.pickup_id);
          }
          return pickupIds;
        }, [occWithFilters, filterDateISO, filterDestinationId, filterTypeName, verifiedRoutes, routeMap]);

        const facetTypeNames = useMemo(() => {
          let occ = occWithFilters;
          if (filterDateISO) occ = occ.filter((o) => o.dateISO === filterDateISO);
          if (filterDestinationId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.destination_id === filterDestinationId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          if (filterPickupId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.pickup_id === filterPickupId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }
          occ = occ.filter((o) => !isSoldOut(o.route_id, o.dateISO));

          const typeNames = new Set<string>();
          for (const o of occ) {
            const name = vehicleTypeNameForRoute(o.route_id);
            if (name && name !== "—") typeNames.add(normType(name));
          }
          return typeNames;
        }, [occWithFilters, filterDateISO, filterDestinationId, filterPickupId, verifiedRoutes]);

        useEffect(() => {
          if (filterDestinationId && !facetDestIds.has(filterDestinationId)) setFilterDestinationId(null);
        }, [facetDestIds, filterDestinationId]);

        useEffect(() => {
          if (filterPickupId && !facetPickupIds.has(filterPickupId)) setFilterPickupId(null);
        }, [facetPickupIds, filterPickupId]);

        useEffect(() => {
          if (filterTypeName && !facetTypeNames.has(filterTypeName)) setFilterTypeName(null);
        }, [facetTypeNames, filterTypeName]);

        useEffect(() => {
          if (activePane === "type" && facetTypeNames.size <= 1) setActivePane("none");
        }, [activePane, facetTypeNames]);

        useEffect(() => {
          if (activePane === "pickup" && facetPickupIds.size <= 1) setActivePane("none");
        }, [activePane, facetPickupIds]);

        const firstImageForType = (normId: string): string | undefined => {
          for (const r of verifiedRoutes) {
            if (normType(vehicleTypeNameForRoute(r.id)) !== normId) continue;
            const d = destById(r.destination_id);
            const p = pickupById(r.pickup_id);
            const img = publicImage(d?.picture_url) || publicImage(p?.picture_url);
            if (img) return img;
          }
          return undefined;
        };

        /* NEW: drill-down navigation helpers */
        const openPickup = (pickupId?: string | null) => {
          if (!pickupId) return;
          window.location.href = `/pickups/${pickupId}`;
        };
        const openDestination = (destId?: string | null) => {
          if (!destId) return;
          window.location.href = `/destinations/${destId}`;
        };

        const filteredOccurrences = useMemo(() => {
          const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
          const minISO = startOfDay(nowPlus25h).toISOString().slice(0, 10);

          let occ = occurrences.filter((o) => o.dateISO >= minISO);

          if (filterDateISO) occ = occ.filter((o) => o.dateISO === filterDateISO);

          if (filterDestinationId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.destination_id === filterDestinationId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }

          if (filterPickupId) {
            const keep = new Set(verifiedRoutes.filter((r) => r.pickup_id === filterPickupId).map((r) => r.id));
            occ = occ.filter((o) => keep.has(o.route_id));
          }

          if (filterTypeName) {
            const keep = new Set(
              verifiedRoutes
                .filter((r) => normType(vehicleTypeNameForRoute(r.id)) === filterTypeName)
                .map((r) => r.id)
            );
            occ = occ.filter((o) => keep.has(o.route_id));
          }

          occ = occ.filter((o) => !isSoldOut(o.route_id, o.dateISO));

          return occ;
        }, [
          occurrences,
          verifiedRoutes,
          filterDateISO,
          filterDestinationId,
          filterPickupId,
          filterTypeName,
          remainingByKeyDB,
          remainingSeatsByKey,
        ]);

        type RowOut = { key: string; route: RouteRow; dateISO: string };
        const rowsAll: RowOut[] = useMemo(() => {
          const map = new Map<string, RouteRow>();
          verifiedRoutes.forEach((r) => map.set(r.id, r));
          return filteredOccurrences
            .map((o) => {
              const r = map.get(o.route_id);
              return r ? { key: o.id, route: r, dateISO: o.dateISO } : null;
            })
            .filter(Boolean) as RowOut[];
        }, [filteredOccurrences, verifiedRoutes]);

        const rows = useMemo(
          () => rowsAll.sort((a, b) => a.dateISO.localeCompare(b.dateISO)).slice(0, MAX_ROWS),
          [rowsAll]
        );

        /* ---------- Live quotes ---------- */
        const [quotesByRow, setQuotesByRow] = useState<Record<string, UiQuote | null>>({});
        const [quoteErrByRow, setQuoteErrByRow] = useState<Record<string, string | null>>({});
        const inventoryReady =
          ((Array.isArray(soldOutKeys) ? soldOutKeys.length : (soldOutKeys as any)?.size ?? 0) > 0) ||
          (assignments.length > 0 && vehicles.length > 0) ||
          orders.length > 0;

        const [seatSelections, setSeatSelections] = useState<Record<string, number>>({});
        const [lastGoodPriceByRow, setLastGoodPriceByRow] = useState<Record<string, number>>({});
        const [lockedPriceByRow, setLockedPriceByRow] = useState<Record<string, number>>({});
        const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
        const inFlightRef = useRef<Map<string, string>>(new Map());

        useEffect(() => {
          if (!rows.length || loading || !inventoryReady) {
            if (!rows.length) {
              if (Object.keys(quotesByRow).length || Object.keys(quoteErrByRow).length) {
                setQuotesByRow({});
                setQuoteErrByRow({});
              }
            }
            return;
          }

          const ac = new AbortController();
          const inFlight = inFlightRef.current;

          (async () => {
            await Promise.all(rows.map(async (r) => {
              const qty = seatSelections[r.key] ?? DEFAULT_SEATS;
              const pinned = quotesByRow[r.key]?.vehicle_id ?? null;

              const sig = `${qty}|${pinned ?? ""}`;
              if (inFlight.get(r.key) === sig) return;
              inFlight.set(r.key, sig);

              const preSoldOut = isSoldOut(r.route.id, r.dateISO);
              if (preSoldOut) {
                setQuotesByRow((p) => ({
                  ...p,
                  [r.key]: {
                    displayPounds: p[r.key]?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0,
                    token: p[r.key]?.token ?? "",
                    availability: "sold_out",
                    currency: p[r.key]?.currency ?? "GBP",
                    vehicle_id: p[r.key]?.vehicle_id ?? null,
                    max_qty_at_price: p[r.key]?.max_qty_at_price ?? null,
                  },
                }));
                setQuoteErrByRow((p) => ({ ...p, [r.key]: null }));
                inFlight.delete(r.key);
                return;
              }

              try {
                const json = await fetchQuoteOnce(r.route.id, r.dateISO, qty, ac.signal, pinned);
                if ("error_code" in json) {
                  const extra = json.step || json.details
                    ? ` (${json.step ?? ""}${json.step && json.details ? ": " : ""}${json.details ?? ""})`
                    : "";
                  setQuotesByRow((p) => ({ ...p, [r.key]: null }));
                  setQuoteErrByRow((p) => ({ ...p, [r.key]: `${json.error_code}${extra}` }));
                  return;
                }

                const unitMinor =
                  (json.unit_cents ?? null) != null
                    ? Number(json.unit_cents)
                    : Math.round(Number(json.perSeatAllInC ?? 0) * 100);

                if (json.max_qty_at_price != null && qty > json.max_qty_at_price) {
                  setQuoteErrByRow((p) => ({ ...p, [r.key]: `Only ${json.max_qty_at_price} seats available at this price.` }));
                } else {
                  setQuoteErrByRow((p) => ({ ...p, [r.key]: null }));
                }

                const computed = Math.ceil(unitMinor / 100);
                const locked = lockedPriceByRow[r.key];
                const toShow = locked != null ? locked : computed;

                setQuotesByRow((p) => ({
                  ...p,
                  [r.key]: {
                    displayPounds: toShow,
                    token: json.token,
                    availability: json.availability,
                    currency: json.currency ?? "GBP",
                    vehicle_id: json.vehicle_id ?? pinned ?? null,
                    max_qty_at_price: json.max_qty_at_price ?? null,
                  },
                }));

                setLastGoodPriceByRow((p) => ({ ...p, [r.key]: toShow }));
                setLockedPriceByRow((p) => (locked != null ? p : { ...p, [r.key]: toShow }));
              } catch (e: any) {
                setQuotesByRow((p) => ({ ...p, [r.key]: null }));
                setQuoteErrByRow((p) => ({ ...p, [r.key]: e?.message ?? "network" }));
              } finally {
                inFlight.delete(r.key);
              }
            }));
          })();

          return () => ac.abort();
        }, [rows, seatSelections, soldOutKeys, remainingByKeyDB, inventoryReady, loading]);

        const handleSeatChange = async (rowKey: string, n: number) => {
          setSeatSelections((prev) => ({ ...prev, [rowKey]: n }));
          const row = rows.find((r) => r.key === rowKey);
          if (!row) return;
          if (isSoldOut(row.route.id, row.dateISO)) return;
          const pinned = quotesByRow[rowKey]?.vehicle_id ?? null;
          try {
            const json = await fetchQuoteOnce(row.route.id, row.dateISO, n, undefined, pinned);
            if ("error_code" in json) {
              const extra = json.step || json.details ? ` (${json.step ?? ""}${json.step && json.details ? ": " : ""}${json.details ?? ""})` : "";
              setQuotesByRow((p) => ({ ...p, [rowKey]: null }));
              setQuoteErrByRow((p) => ({ ...p, [rowKey]: `${json.error_code}${extra}` }));
              return;
            }
            const unitMinor = (json.unit_cents ?? null) != null ? Number(json.unit_cents) : Math.round(Number(json.perSeatAllInC ?? 0) * 100);
            if (json.max_qty_at_price != null && n > json.max_qty_at_price) {
              setQuoteErrByRow((p) => ({ ...p, [rowKey]: `Only ${json.max_qty_at_price} seats available at this price.` }));
            } else {
              setQuoteErrByRow((p) => ({ ...p, [rowKey]: null }));
            }
            const computed = Math.ceil(unitMinor / 100);
            const locked = lockedPriceByRow[rowKey];
            const toShow = (locked != null) ? locked : computed;
            setQuotesByRow((p) => ({
              ...p,
              [rowKey]: {
                displayPounds: toShow,
                token: json.token,
                availability: json.availability,
                currency: json.currency ?? "GBP",
                vehicle_id: json.vehicle_id ?? pinned ?? null,
                max_qty_at_price: json.max_qty_at_price ?? null,
              },
            }));
            setLastGoodPriceByRow((p) => ({ ...p, [rowKey]: toShow }));
            setLockedPriceByRow((p) => (locked != null ? p : { ...p, [rowKey]: toShow }));
          } catch (e: any) {
            setQuotesByRow((p) => ({ ...p, [rowKey]: null }));
            setQuoteErrByRow((p) => ({ ...p, [rowKey]: e?.message ?? "network" }));
          }
        };

        const handleContinue = async (rowKey: string, routeId: string) => {
          if (!supabase) { alert("Supabase client is not configured."); return; }
          const row = rows.find((r) => r.key === rowKey);
          const q   = quotesByRow[rowKey];
          if (!row) { alert("Missing row data."); return; }
          if (isSoldOut(routeId, row.dateISO)) { alert("Sorry, this departure is sold out."); return; }
          const seats = (seatSelections[rowKey] ?? DEFAULT_SEATS);
          const departure_ts = makeDepartureISO(row.dateISO, row.route.pickup_time);

          let confirm: QuoteOk;
          try {
            const result = await fetchQuoteOnce(routeId, row.dateISO, seats, undefined, q?.vehicle_id ?? null);
            if ("error_code" in result) { alert(`Live quote check failed: ${result.error_code}${result.details ? ` — ${result.details}` : ""}`); return; }
            if (result.availability === "sold_out") { alert("Sorry, this departure has just sold out."); return; }
            if (result.max_qty_at_price != null && seats > result.max_qty_at_price) {
              alert(`Only ${result.max_qty_at_price} seats are available at this price. Please lower the seat count or choose another date.`);
              return;
            }
            confirm = result;
          } catch (e: any) {
            alert(e?.message ?? "Could not re-confirm the live price. Please try again.");
            return;
          }

          try {
            const { data, error } = await supabase
              .from("quote_intents")
              .insert({
                route_id: routeId,
                date_iso: row.dateISO,
                departure_ts,
                seats,
                per_seat_all_in: (lockedPriceByRow[rowKey] ?? quotesByRow[rowKey]?.displayPounds ?? lastGoodPriceByRow[rowKey] ?? null),
                currency: q?.currency ?? "GBP",
                quote_token: confirm.token,
              })
              .select("id")
              .single();

            if (error || !data?.id) {
              console.error("quote_intents insert failed:", error?.message ?? error ?? "unknown");
              alert(error?.message ?? "Could not create your quote reference. Please try again.");
              return;
            }

            const nextUrl = `/checkout?qid=${data.id}`;
            const { data: sessionData } = await supabase.auth.getSession();
            const isSignedIn = !!sessionData?.session?.user;
            if (!isSignedIn) {
              window.location.href = `${LOGIN_PATH}?next=${encodeURIComponent(nextUrl)}`;
              return;
            }
            window.location.href = nextUrl;
          } catch (e: any) {
            console.error("quote_intents insert exception:", e);
            alert(e?.message ?? "Could not create your quote reference. Please try again.");
          }
        };

        /* ---------- Calendar helpers ---------- */
        const monthLabel = useMemo(
          () => calCursor.toLocaleString(undefined, { month: "long", year: "numeric" }),
          [calCursor]
        );

        const namesByDate = useMemo(() => {
          const m = new Map<string, string[]>();
          const nameOf = (r: RouteRow) => {
            const pu = pickupById(r.pickup_id)?.name ?? "—";
            const de = destById(r.destination_id)?.name ?? "—";
            return `${pu} → ${de}`;
          };
          filteredOccurrences.forEach((o) => {
            const r = routeMap.get(o.route_id);
            if (!r) return;
            const arr = m.get(o.dateISO) ?? [];
            arr.push(nameOf(r));
            m.set(o.dateISO, arr);
          });
          return m;
        }, [filteredOccurrences, pickups, destinations, routeMap]);

        const calendarDays = useMemo(() => {
          const first = startOfMonth(calCursor);
          const last = endOfMonth(calCursor);
          const firstDow = (first.getDay() + 6) % 7;
          const days: { iso: string; inMonth: boolean; label: number }[] = [];
          for (let i = firstDow - 1; i >= 0; i--) {
            const d = addDays(first, -i - 1);
            days.push({ iso: d.toISOString().slice(0,10), inMonth: false, label: d.getDate() });
          }
          for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
            days.push({ iso: d.toISOString().slice(0,10), inMonth: true, label: d.getDate() });
          }
          while (days.length % 7 !== 0 || days.length < 42) {
            const d = addDays(last, days.length);
            days.push({ iso: d.toISOString().slice(0,10), inMonth: false, label: d.getDate() });
          }
          return days.slice(0, 42);
        }, [calCursor]);

        // ===== SECTION 2: Safe globals pulled from hydrate =====
        const availableCountryIdSet = useMemo(
          () => new Set(Object.keys(availableDestinationsByCountry)),
          [availableDestinationsByCountry]
        );

        // ===== SECTION 4: Render =====
        let content: React.ReactNode = null;

        if (!countryId) {
          const visibleCountries = countries.filter((c) => availableCountryIdSet.has(c.id));

          content = (
            <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
              {hydrated && !supabase && (
                <Banner>
                  Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
                </Banner>
              )}

              {msg && (
                <Banner>
                  <span className="font-medium">Error:</span> {msg}
                </Banner>
              )}

              <section className="space-y-4">
                <p className="text-lg">
                  <strong>Pace Shuttle</strong> offers fractional luxury charter and shuttle services to world-class,
                  often inaccessible, luxury destinations.
                </p>
              </section>

              <section>
                <div className="relative w-full overflow-hidden rounded-2xl tile tile-border">
                  <div className="aspect-[16/10] sm:aspect-[21/9]">
                    <Image
                      src={HERO_IMG_URL}
                      alt="Pace Shuttle — luxury transfers"
                      fill
                      priority
                      className="object-cover"
                      sizes="100vw"
                    />
                  </div>
                </div>
              </section>

              <section className="text-center pt-6">
                <div className="font-semibold">Pace Shuttles is currently operating in the following locations.</div>
                <div className="text-muted">Book your dream arrival today</div>
              </section>

              <section className="mx-auto max-w-5xl">
                {visibleCountries.length === 0 && (
                  <div className="text-sm text-muted mb-3">No countries available yet.</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleCountries.map((c) => {
                    const imgUrl = publicImage(c.picture_url);
                    return (
                      <button
                        key={c.id}
                        className="text-left tile tile-border overflow-hidden transition hover:shadow-app"
                        onClick={() => {
                          setCountryId(c.id);
                          setActivePane("destination");
                          setFilterDateISO(null);
                          setFilterDestinationId(null);
                          setFilterPickupId(null);
                          setFilterTypeName(null);
                          setCalCursor(startOfMonth(new Date()));
                        }}
                      >
                        <div className="relative w-full aspect-[4/3]">
                          {imgUrl ? (
                            <Image
                              src={imgUrl}
                              alt={c.name}
                              fill
                              unoptimized
                              className="object-cover"
                              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                            />
                          ) : (
                            <div className="h-full w-full bg-card" />
                          )}
                        </div>
                        <div className="p-4">
                          <div className="font-medium">{c.name}</div>
                          {c.description && (
                            <div className="mt-1 text-sm text-muted line-clamp-3">{c.description}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="pt-10">
                <a href="/partners" aria-label="Partner with Pace Shuttles">
                  <Image
                    src={FOOTER_CTA_IMG_URL}
                    alt="Partner with Pace Shuttles"
                    width={2400}
                    height={600}
                    sizes="100vw"
                    priority={false}
                    className="w-full h-auto rounded-2xl tile tile-border"
                  />
                </a>
              </section>
            </div>
          );
        } else {
          /* Planner UI (country selected) */
          const allowedDestIds = new Set(availableDestinationsByCountry[countryId] ?? []);

          const showTypeFacet = facetTypeNames.size >= 2;
          const showPickupFacet = facetPickupIds.size >= 2;

          const filterPills = (["date","destination"] as const)
            .concat(showPickupFacet ? (["pickup"] as const) : [])
            .concat(showTypeFacet ? (["type"] as const) : []);

          const crumbs: { key: "date"|"destination"|"pickup"|"type"; label: string }[] = [];
          if (filterDateISO) crumbs.push({ key: "date", label: new Date(filterDateISO + "T12:00:00").toLocaleDateString() });
          if (filterDestinationId) {
            const d = destById(filterDestinationId);
            if (d) crumbs.push({ key: "destination", label: d.name });
          }
          if (filterPickupId) {
            const p = pickupById(filterPickupId);
            if (p) crumbs.push({ key: "pickup", label: p.name });
          }
          if (filterTypeName) {
            const t = transportTypeByNormName[filterTypeName];
            crumbs.push({ key: "type", label: t?.name ?? titleCase(filterTypeName) });
          }

          content = (
            <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
              {hydrated && !supabase && (
                <Banner>
                  Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
                </Banner>
              )}
              {msg && (
                <Banner>
                  <span className="font-medium">Error:</span> {msg}
                </Banner>
              )}

              <header className="space-y-2">
                <h1 className="text-2xl heading">Plan your shuttle</h1>
                <p className="text-muted">Use the tiles below to filter, then pick a journey.</p>
              </header>

              <div className="flex items-center gap-2">
                <button className="pill pill-idle subtle-border" onClick={() => setCountryId("")}>← change country</button>
              </div>

              {/* Filters */}
              <section className="tile tile-border p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {filterPills.map((k) => (
                    <button
                      key={k}
                      className={`pill ${activePane === k ? "pill-active" : "pill-idle subtle-border"}`}
                      onClick={() => setActivePane((p) => (p === k ? "none" : k))}
                    >
                      {k[0].toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                  {(filterDateISO || filterDestinationId || filterPickupId || filterTypeName) && (
                    <button
                      className="ml-auto pill subtle-border"
                      onClick={() => { setFilterDateISO(null); setFilterDestinationId(null); setFilterPickupId(null); setFilterTypeName(null); }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>

                {(crumbs.length > 0) && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="text-muted">Active filters:</span>
                    {crumbs.map(c => (
                      <span key={c.key} className="inline-flex items-center gap-1 pill subtle-border">
                        <span className="font-medium">{c.key[0].toUpperCase() + c.key.slice(1)}:</span>
                        <span>{c.label}</span>
                        <button
                          aria-label={`Clear ${c.key} filter`}
                          className="ml-1 hover:text-red-400"
                          onClick={() => {
                            if (c.key === "date") setFilterDateISO(null);
                            if (c.key === "destination") setFilterDestinationId(null);
                            if (c.key === "pickup") setFilterPickupId(null);
                            if (c.key === "type") setFilterTypeName(null);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {activePane === "date" && (
                  <div className="border-t border-[color:var(--border)] pt-4">
                    {(crumbs.length > 0) && (
                      <div className="mb-2 text-xs text-muted">
                        Calendar shows dates matching your active filters above.
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-3">
                      <button className="pill subtle-border" onClick={() => setCalCursor(addMonths(calCursor, -1))}>←</button>
                      <div className="text-lg font-medium" suppressHydrationWarning>{monthLabel}</div>
                      <button className="pill subtle-border" onClick={() => setCalCursor(addMonths(calCursor, 1))}>→</button>
                    </div>
                    <div className="grid grid-cols-7 gap-2 text-center text-xs text-muted mb-1">
                      {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-2">
                      {calendarDays.map((d, i) => {
                        const selected = filterDateISO === d.iso;
                        const names = namesByDate.get(d.iso) || [];
                        return (
                          <button
                            key={d.iso + i}
                            className="min-h-[112px] text-left p-2 rounded-xl subtle-border transition"
                            style={
                              selected
                                ? { background: "var(--accent)", color: "var(--accent-contrast)", borderColor: "transparent" }
                                : { background: d.inMonth ? "var(--card)" : "rgba(255,255,255,0.04)", color: d.inMonth ? "var(--text)" : "var(--muted)" }
                            }
                            onClick={() => setFilterDateISO(d.iso)}
                          >
                            <div className="text-xs opacity-70">{d.label}</div>
                            <div className="mt-1 space-y-1">
                              {names.map((n, idx) => (
                                <div key={idx} className="text-[11px] leading-snug whitespace-normal break-words">{n}</div>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {filterDateISO && (
                      <div className="mt-3 text-sm text-muted" suppressHydrationWarning>
                        Selected: {new Date(filterDateISO + "T12:00:00").toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}

                {activePane === "destination" && (
                  <TilePicker
                    title="Choose a destination"
                    items={destinations
                      .filter((d) => allowedDestIds.has(d.id) && facetDestIds.has(d.id))
                      .map((d) => ({ id: d.id, name: d.name, description: d.description ?? "", image: publicImage(d.picture_url) }))}
                    onChoose={(id) => { setFilterDestinationId(id); setActivePane("none"); }}
                    selectedId={filterDestinationId}
                    includeAll={false}
                  />
                )}

                {activePane === "pickup" && showPickupFacet && (
                  <TilePicker
                    title="Choose a pick-up point"
                    items={pickups
                      .filter((p) => facetPickupIds.has(p.id))
                      .map((p) => ({ id: p.id, name: p.name, description: p.description ?? "", image: publicImage(p.picture_url) }))}
                    onChoose={(id) => { setFilterPickupId(id); setActivePane("none"); }}
                    selectedId={filterPickupId}
                    includeAll={false}
                  />
                )}

                {/* TYPE: build from facetTypeNames with graceful fallback (now with fallback image) */}
                {activePane === "type" && showTypeFacet && (
                  <TilePicker
                    title="Choose a vehicle type"
                    items={Array.from(facetTypeNames).map((normId) => {
                      const t = transportTypeByNormName[normId];
                      return {
                        id: normId,
                        name: t?.name ?? titleCase(normId),
                        description: t?.description ?? "",
                        image: t ? typeImgSrc(t) : firstImageForType(normId),
                      };
                    })}
                    onChoose={(normId) => { setFilterTypeName(normId); setActivePane("none"); }}
                    selectedId={filterTypeName ?? undefined}
                    includeAll={false}
                  />
                )}
              </section>

              {/* Mobile-first Journey Cards */}
              <section className="md:hidden space-y-3">
                {loading ? (
                  <div className="p-4 tile tile-border">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="p-4 tile tile-border">No journeys match your filters.</div>
                ) : (
                  rows.map((r) => {
                    const pu = pickupById(r.route.pickup_id);
                    const de = destById(r.route.destination_id);
                    const vType = vehicleTypeNameForRoute(r.route.id);
                    const q = quotesByRow[r.key];

                    const hasLivePrice = !!q?.token;
                    const priceDisplay = (lockedPriceByRow[r.key] ?? q?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0);
                    const selected = seatSelections[r.key] ?? 2;
                    const err = quoteErrByRow[r.key];

                    const k = `${r.route.id}_${r.dateISO}`;
                    const remaining =
                      (remainingByKeyDB as Record<string, number>)[k] ??
                      remainingSeatsByKey.get(k) ??
                      0;

                    const overMaxAtPrice = q?.max_qty_at_price != null ? selected > q.max_qty_at_price : false;

                    return (
                      <div key={r.key} className="space-y-2">
                        <JourneyCard
                          pickupName={pu?.name ?? "—"}
                          pickupImg={publicImage(pu?.picture_url)}
                          destName={de?.name ?? "—"}
                          destImg={publicImage(de?.picture_url)}
                          dateISO={r.dateISO}
                          timeStr={hhmmLocalToDisplay(r.route.pickup_time)}
                          durationMins={r.route.approx_duration_mins ?? undefined}
                          vehicleType={vType}
                          soldOut={false}
                          priceLabel={hasLivePrice ? currencyIntPounds(priceDisplay) : "—"}
                          lowSeats={(remaining > 0 && remaining <= 5) ? remaining : undefined}
                          errorMsg={overMaxAtPrice ? `Only ${q?.max_qty_at_price ?? 0} seats available at this price.` : err ?? undefined}
                          seats={selected}
                          onSeatsChange={(n) => handleSeatChange(r.key, n)}
                          onContinue={() => handleContinue(r.key, r.route.id)}
                          continueDisabled={false}
                          /* NEW: make images clickable */
                          onOpenPickup={() => openPickup(pu?.id)}
                          onOpenDestination={() => openDestination(de?.id)}
                        />
                      </div>
                    );
                  })
                )}
              </section>

              {/* Desktop/tablet table latest changes */}
              <section className="tile tile-border overflow-hidden hidden md:block">
                {loading ? (
                  <div className="p-4">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="p-4">No journeys match your filters.</div>
                ) : (
                  <table className="ps">
                    <thead>
                      <tr>
                        <th className="text-left">Pick-up</th>
                        <th className="text-left">Destination</th>
                        <th className="text-left">Date</th>
                        <th className="text-left">Time</th>
                        <th className="text-left">Duration (mins)</th>
                        <th className="text-left">Vehicle Type</th>
                        <th className="text-right">Seat price</th>
                        <th className="text-left">Seats</th>
                        <th className="text-left"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const pu = pickupById(r.route.pickup_id);
                        const de = destById(r.route.destination_id);
                        const vType = vehicleTypeNameForRoute(r.route.id);
                        const q = quotesByRow[r.key];

                        const hasLivePrice = !!q?.token;

                        const priceDisplay = (lockedPriceByRow[r.key] ?? q?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0);
                        const selected = seatSelections[r.key] ?? 2;
                        const err = quoteErrByRow[r.key];

                        const k = `${r.route.id}_${r.dateISO}`;
                        const remaining = ((remainingByKeyDB as Record<string, number>)[k] ?? remainingSeatsByKey.get(k) ?? 0) as number;

                        const overMaxAtPrice = q?.max_qty_at_price != null ? selected > q.max_qty_at_price : false;
                        const showLowSeats = remaining > 0 && remaining <= 5;

                        return (
                          <tr key={r.key} className="align-top">
                            <td>
                              <button
                                type="button"
                                onClick={() => openPickup(pu?.id)}
                                className="flex items-center gap-2 text-left group"
                                aria-label={`View pick-up: ${pu?.name ?? ""}`}
                                title={pu?.name ?? "Pick-up"}
                              >
                                <span className="relative h-10 w-16 overflow-hidden rounded subtle-border">
                                  <Image
                                    src={publicImage(pu?.picture_url) || "/placeholder.png"}
                                    alt={pu?.name || "Pick-up"}
                                    fill
                                    unoptimized
                                    className="object-cover group-hover:opacity-90"
                                    sizes="64px"
                                  />
                                </span>
                                <span className="underline underline-offset-2">{pu?.name ?? "—"}</span>
                              </button>
                            </td>

                            <td>
                              <button
                                type="button"
                                onClick={() => openDestination(de?.id)}
                                className="flex items-center gap-2 text-left group"
                                aria-label={`View destination: ${de?.name ?? ""}`}
                                title={de?.name ?? "Destination"}
                              >
                                <span className="relative h-10 w-16 overflow-hidden rounded subtle-border">
                                  <Image
                                    src={publicImage(de?.picture_url) || "/placeholder.png"}
                                    alt={de?.name || "Destination"}
                                    fill
                                    unoptimized
                                    className="object-cover group-hover:opacity-90"
                                    sizes="64px"
                                  />
                                </span>
                                <span className="underline underline-offset-2">{de?.name ?? "—"}</span>
                              </button>
                            </td>

                            <td suppressHydrationWarning>{new Date(r.dateISO + "T12:00:00").toLocaleDateString()}</td>
                            <td suppressHydrationWarning>{hhmmLocalToDisplay(r.route.pickup_time)}</td>
                            <td>{r.route.approx_duration_mins ?? "—"}</td>
                            <td>{vType}</td>
                            <td className="text-right">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="font-semibold">
                                  {hasLivePrice ? currencyIntPounds(priceDisplay) : "—"}
                                </span>
                                <span className="text-xs text-muted">
                                  {hasLivePrice ? "Per ticket (incl. tax & fees)" : (err ? `Quote error: ${err}` : "Awaiting live price")}
                                </span>
                                {showLowSeats && (
                                  <div className="text-[11px] text-amber-400 mt-0.5">
                                    Only {remaining} seat{remaining === 1 ? "" : "s"} left
                                  </div>
                                )}
                                {!showLowSeats && !overMaxAtPrice && err && (
                                  <div className="text-[11px] text-amber-400 mt-0.5">{err}</div>
                                )}
                              </div>
                            </td>
                            <td>
                              <select
                                className="pill subtle-border"
                                value={selected}
                                onChange={(e) => handleSeatChange(r.key, parseInt(e.target.value))}
                              >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}</option>))}
                              </select>
                            </td>
                            <td>
                              <button
                                className="btn btn-primary"
                                title={
                                  overMaxAtPrice ? `Only ${q?.max_qty_at_price ?? 0} seats available at this price.`
                                  : hasLivePrice ? "Continue" : "Continue (price will be confirmed on next step)"
                                }
                                onClick={() => handleContinue(r.key, r.route.id)}
                              >
                                Continue
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          );
        }

        return content;
      })()}
    </div>
  );
}
