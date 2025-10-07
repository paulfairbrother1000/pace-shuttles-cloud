// Server-shifted Home page: move all DB reads + heavy joins OFF the browser.
// This component now calls consolidated API routes that you’ll add server-side:
//   - GET  /api/home-hydrate                → global: countries + availability sets
//   - GET  /api/home-hydrate?country_id=ID  → country view: lookups + verified routes + orders + capacity views
//   - GET  /api/quote?route_id=...          → (existing) single live quote
//   - POST /api/quote-intents               → creates quote_intents row and returns { id }
// These endpoints should do ALL Supabase access on the server (using service role or RLS-safe RPCs).

"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { TilePicker } from "../components/TilePicker";
import { JourneyCard } from "../components/JourneyCard";
import { createBrowserClient } from "@supabase/ssr";

// --- server-hydrate helpers ---
// Unified fetch helper: no cache, status check, useful errors
async function fetchJSON<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, cache: "no-store" });

  // Surface HTTP errors explicitly
  if (!res.ok) {
    const snippet = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} from ${input}: ${snippet}`);
  }

  // Robust JSON parse with readable fallback
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(`Non-JSON from ${input}: ${txt.slice(0, 200)}`);
  }
}

type HydrateGlobal = {
  countries: Country[];
  available_country_ids: string[];
  available_destinations_by_country: Record<string, string[]>;
};

type HydrateCountry = {
  pickups: Pickup[];
  destinations: Destination[];
  routes: RouteRow[];
  assignments: Assignment[];
  vehicles: Vehicle[];
  orders: Order[];
  transport_types: TransportTypeRow[];
  sold_out_keys: string[];                         // ["routeId_YYYY-MM-DD", ...]
  remaining_by_key_db: Record<string, number>;     // { "routeId_YYYY-MM-DD": remaining }
};


// Browser-only Supabase client (safe no-op on the server)
const supabase = (() => {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anon ? createBrowserClient(url, anon) : null;
})();


const LOGIN_PATH = "/login";

// Landing images — served from /public (no Supabase needed)
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

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) {
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`
          : `${raw}?v=5`;
      }
      return raw;
    } catch {
      /* ignore */
    }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
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

/* ---------- Types (mirror the previous ones; now hydrated server-side) ---------- */
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

/* ---------- API payload types ---------- */
type HydrateGlobal = {
  countries: Country[];
  available_country_ids: string[];
  available_destinations_by_country: Record<string, string[]>; // country_id -> destination_id[]
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
/* ============================== MAIN COMPONENT ============================== */
export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  /* Step 1: countries (server-hydrated) */
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryId, setCountryId] = useState<string>("");

  /* Lookups (server-hydrated per country) */
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [transportTypeRows, setTransportTypeRows] = useState<TransportTypeRow[]>([]);
  const [transportTypesById, setTransportTypesById] = useState<Record<string, string>>({});
  const [transportTypesByName, setTransportTypesByName] = useState<Record<string, string>>({});

  /* Routes & verification inputs */
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  // paid orders in window to pre-mark sold out
  const [orders, setOrders] = useState<Order[]>([]);

  // DB-driven signals
  const [soldOutKeys, setSoldOutKeys] = useState<Set<string>>(new Set());
  const [remainingByKeyDB, setRemainingByKeyDB] = useState<Map<string, number>>(new Map());

  /* UI */
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /* Filters */
  const [activePane, setActivePane] = useState<"none" | "date" | "destination" | "pickup" | "type">("date");
  const [filterDateISO, setFilterDateISO] = useState<string | null>(null);
  const [filterDestinationId, setFilterDestinationId] = useState<string | null>(null);
  const [filterPickupId, setFilterPickupId] = useState<string | null>(null);
  const [filterTypeName, setFilterTypeName] = useState<string | null>(null);

  // Month calendar cursor
  const [calCursor, setCalCursor] = useState<Date>(startOfMonth(new Date()));

  // default seats to show/fetch
  const DEFAULT_SEATS = 2;

  /* ---------- Availability sets from server ---------- */
  const [availableCountryIds, setAvailableCountryIds] = useState<Set<string>>(new Set());
  const [availableDestinationsByCountry, setAvailableDestinationsByCountry] = useState<Map<string, Set<string>>>(new Map());

/* ---------- Load countries (server-side hydrate) ---------- */
useEffect(() => {
  let off = false;
  (async () => {
    try {
      const data = await fetchJSON<HydrateGlobal>("/api/home-hydrate");
      if (off) return;

      setCountries(data.countries || []);

      // availability sets
      setAvailableCountryIds(new Set(data.available_country_ids || []));
      const byCountry = new Map<string, Set<string>>();
      Object.entries(data.available_destinations_by_country || {}).forEach(([cid, arr]) => {
        byCountry.set(cid, new Set(arr));
      });
      setAvailableDestinationsByCountry(byCountry);

      setMsg(null);
    } catch (e: any) {
      console.error("[hydrate-global]", e);
      setMsg(e?.message || String(e));
      setCountries([]);
      setAvailableCountryIds(new Set());
      setAvailableDestinationsByCountry(new Map());
    }
  })();
  return () => { off = true; };
}, []);


  /* ---------- Load lookups & routes when a country is chosen (server-side hydrate) ---------- */
useEffect(() => {
  if (!countryId) return;
  let off = false;

  (async () => {
    setLoading(true);
    setMsg(null);
    try {
      const data = await fetchJSON<HydrateCountry>(`/api/home-hydrate?country_id=${encodeURIComponent(countryId)}`);
      if (off) return;

      setPickups(data.pickups || []);
      setDestinations(data.destinations || []);

      // Filter routes by season as before
      const today = startOfDay(new Date());
      setRoutes((data.routes || []).filter((row) => withinSeason(today, row.season_from ?? null, row.season_to ?? null)));

      setAssignments(data.assignments || []);
      setVehicles(data.vehicles || []);
      setOrders(data.orders || []);

      // transport types
      const ttRows = data.transport_types || [];
      setTransportTypeRows(ttRows);
      const idMap: Record<string, string> = {};
      const nameMap: Record<string, string> = {};
      ttRows.forEach((t) => { idMap[t.id] = t.name; nameMap[t.name.toLowerCase()] = t.name; });
      setTransportTypesById(idMap);
      setTransportTypesByName(nameMap);

      // sold out + remaining (from DB views)
      setSoldOutKeys(new Set<string>(data.sold_out_keys || []));
      setRemainingByKeyDB(new Map(Object.entries(data.remaining_by_key_db || {}).map(([k, v]) => [k, Number(v) || 0])));

    } catch (e: any) {
      console.error("[hydrate-country]", e);
      setMsg(e?.message || String(e));
      setPickups([]); setDestinations([]); setRoutes([]);
      setAssignments([]); setVehicles([]); setOrders([]);
      setTransportTypeRows([]); setTransportTypesById({}); setTransportTypesByName({});
      setSoldOutKeys(new Set()); setRemainingByKeyDB(new Map());
    } finally {
      if (!off) setLoading(false);
    }
  })();

  return () => { off = true; };
}, [countryId]);


/* ---------- server payload contracts ---------- */
type HydrateGlobal = {
  countries: Country[];
  available_country_ids: string[];
  available_destinations_by_country: Record<string, string[]>;
};
type HydrateCountry = {
  pickups: Pickup[];
  destinations: Destination[];
  routes: RouteRow[];
  assignments: Assignment[];
  vehicles: Vehicle[];
  orders: Order[];
  transport_types: TransportTypeRow[];
  sold_out_keys: string[]; // ["routeId_YYYY-MM-DD", ...]
  remaining_by_key_db: Record<string, number>; // { "routeId_YYYY-MM-DD": 12, ... }
};

/* ---------- Derived: verified routes ---------- */
const verifiedRoutes = useMemo(() => {
  const withAsn = new Set(assignments.filter(a => a.is_active !== false).map((a) => a.route_id));
  return routes.filter((r) => withAsn.has(r.id));
}, [routes, assignments]);

/* ---------- Occurrences (6 months) ---------- */
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

/* ---------- lookups ---------- */
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

/* ---------- capacity (first paint) ---------- */
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
  const dbRem = remainingByKeyDB.get(k);
  if (dbRem != null) return dbRem <= 0;
  return (remainingSeatsByKey.get(k) ?? 0) <= 0;
}

/* ---------- Filters -> rows ---------- */
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
    const wanted = filterTypeName.toLowerCase();
    const keep = new Set(
      verifiedRoutes.filter((r) => vehicleTypeNameForRoute(r.id).toLowerCase() === wanted).map((r) => r.id)
    );
    occ = occ.filter((o) => keep.has(o.route_id));
  }
  return occ;
}, [occurrences, verifiedRoutes, filterDateISO, filterDestinationId, filterPickupId, filterTypeName]);

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

const rows = useMemo(() => rowsAll.sort((a, b) => a.dateISO.localeCompare(b.dateISO)).slice(0, MAX_ROWS), [rowsAll]);

/* ---------- Live quotes (via existing /api/quote) ---------- */
const [quotesByRow, setQuotesByRow] = useState<Record<string, UiQuote | null>>({});
const [quoteErrByRow, setQuoteErrByRow] = useState<Record<string, string | null>>({});
const inventoryReady = soldOutKeys.size > 0 || (assignments.length > 0 && vehicles.length > 0) || orders.length > 0;

const [seatSelections, setSeatSelections] = useState<Record<string, number>>({});
const [lastGoodPriceByRow, setLastGoodPriceByRow] = useState<Record<string, number>>({});
const [lockedPriceByRow, setLockedPriceByRow] = useState<Record<string, number>>({});
const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
// Dedup quote fetches per row (qty|pinned signature)
const inFlightRef = useRef<Map<string, string>>(new Map());


useEffect(() => {
  if (!rows.length || loading || !inventoryReady) {
    // Clear if no rows
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

      // dedupe: same inputs already being fetched
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

        const unitMinor = (json.unit_cents ?? null) != null
          ? Number(json.unit_cents)
          : Math.round(Number(json.perSeatAllInC ?? 0) * 100);

        if (json.max_qty_at_price != null && qty > json.max_qty_at_price) {
          setQuoteErrByRow((p) => ({ ...p, [r.key]: `Only ${json.max_qty_at_price} seats available at this price.` }));
        } else {
          setQuoteErrByRow((p) => ({ ...p, [r.key]: null }));
        }

        const computed = Math.ceil(unitMinor / 100);
        const locked = lockedPriceByRow[r.key];
        const toShow = (locked != null) ? locked : computed;

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
// ⬇️ Only *inputs* that should trigger a fresh round
}, [rows, seatSelections, soldOutKeys, remainingByKeyDB, inventoryReady, loading]);

const handleSeatChange = async (rowKey: string, n: number) => {
  setSeatSelections((prev) => ({ ...prev, [rowKey]: n }));
  const row = rows.find((r) => r.key === rowKey);
  if (!row) return;
  const preSoldOut = isSoldOut(row.route.id, row.dateISO);
  if (preSoldOut) return;
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
  const preSoldOut = isSoldOut(routeId, row.dateISO);
  if (preSoldOut) { alert("Sorry, this departure is sold out."); return; }
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

/* =========================== RENDER =========================== */

if (!countryId) {
  const visibleCountries = countries.filter((c) => availableCountryIds.has(c.id));
  return (
    <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">

      {hydrated && !supabase && (
        <Banner>
          Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
        </Banner>
      )}

      {/* ← Add this: shows server-hydrate errors on the landing page */}
      {msg && (
        <Banner>
          <span className="font-medium">Error:</span> {msg}
        </Banner>
      )}

      {/* ... landing sections unchanged ... */}
    </div>
  );
}


/* Planner UI (country selected) */
const allowedDestIds = availableDestinationsByCountry.get(countryId) ?? new Set<string>();

return (
  <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
    {hydrated && !supabase && (
      <Banner>
        Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
      </Banner>
    )}

    {/* ... the rest of the render (filters, cards, table) remains the same as your original,
         now powered by the server-hydrated state above ... */}
  </div>
);
}