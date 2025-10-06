"use client";

import { TilePicker } from "../components/TilePicker";
import { JourneyCard } from "../components/JourneyCard";


const LOGIN_PATH = "/login";

// Landing images — served from /public (no Supabase needed)
const HERO_IMG_URL = "/pace-hero.jpg";
const FOOTER_CTA_IMG_URL = "/partners-cta.jpg";

/** Only create the client in the browser and when envs exist. */
const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      )
    : null;

/** DEV helper: expose NEXT_PUBLIC vars for quick inspection (never logs server-only keys). */
if (typeof window !== "undefined") {
  (window as any).PaceEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").slice(0, 8) + "...",
    NEXT_PUBLIC_PUBLIC_BUCKET: process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images",
    NEXT_PUBLIC_APP_TARGET: process.env.NEXT_PUBLIC_APP_TARGET || "unknown",
    NODE_ENV: process.env.NODE_ENV,
  };
  // eslint-disable-next-line no-console
  console.log("[Pace] NEXT_PUBLIC envs:", (window as any).PaceEnv);
}

/* ---------- Tiny banner component for warnings ---------- */
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      {children}
    </div>
  );
}

/* ---------- Image URL normalizer ---------- */
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
/* ---------- Types ---------- */
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

  const res = await fetch(`/api/quote?${sp.toString()}`, { method: "GET", cache: "no-store", signal });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { error_code: `non_json_${res.status}`, details: txt.slice(0, 160) }; }
}

/* ---------- Greedy allocator ---------- */
type Party = { size: number };
function allocatePartiesForRemaining(parties: Party[], boats: { vehicle_id: string; cap: number; preferred: boolean }[]) {
  const groups = [...parties].filter(g => g.size > 0).sort((a, b) => b.size - a.size);
  const state = boats.map(b => ({ id: b.vehicle_id, cap: Math.max(0, Math.floor(b.cap)), used: 0, preferred: !!b.preferred }));
  let unassigned = 0;
  for (const g of groups) {
    const candidates = state
      .map(s => ({ id: s.id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter(c => c.free >= g.size)
      .sort((a, b) => (a.preferred === b.preferred ? a.free - b.free : (a.preferred ? -1 : 1)));
    if (!candidates.length) { unassigned += g.size; continue; }
    candidates[0].ref.used += g.size;
  }
  const used = state.reduce((s, x) => s + x.used, 0);
  const cap  = state.reduce((s, x) => s + x.cap, 0);
  return { remaining: Math.max(0, cap - used) };
}

/* ============================== MAIN COMPONENT ============================== */
export default function HomePage() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  /* Step 1: countries */
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryId, setCountryId] = useState<string>("");

  /* Lookups */
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [transportTypeRows, setTransportTypeRows] = useState<TransportTypeRow[]>([]);
  const [transportTypesById, setTransportTypesById] = useState<Record<string, string>>({});
  const [transportTypesByName, setTransportTypesByName] = useState<Record<string, string>>({});

  /* Routes & verification */
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

  /* ---------- Load countries ---------- */
  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) { setCountries([]); return; }
      const { data, error } = await supabase.from("countries").select("id,name,description,picture_url").order("name");
      if (off) return;
      if (error) { setMsg(error.message); return; }
      setCountries((data as Country[]) || []);
    })();
    return () => { off = true; };
  }, []);

  /* ---------- Load lookups & routes when a country is chosen ---------- */
  useEffect(() => {
    if (!countryId) return;
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      if (!supabase) { setLoading(false); return; }

      try {
        const [pu, de, r, tt] = await Promise.all([
          supabase.from("pickup_points").select("id,name,country_id,picture_url,description").eq("country_id", countryId).order("name"),
          supabase.from("destinations").select("id,name,country_id,picture_url,description,url").eq("country_id", countryId).order("name"),
          supabase.from("routes")
            .select(`*, countries:country_id ( id, name, timezone )`)
            .eq("country_id", countryId).eq("is_active", true)
            .order("created_at", { ascending: false }),
          supabase.from("transport_types").select("id,name,description,picture_url,is_active"),
        ]);

        if (off) return;
        if (pu.error || de.error || r.error || tt.error) {
          setMsg(pu.error?.message || de.error?.message || r.error?.message || tt.error?.message || "Load failed");
          setLoading(false);
          return;
        }

        setPickups((pu.data as Pickup[]) || []);
        setDestinations((de.data as Destination[]) || []);

        const today = startOfDay(new Date());
        setRoutes(((r.data as RouteRow[]) || []).filter((row) => withinSeason(today, row.season_from ?? null, row.season_to ?? null)));

        const ttRows = (tt.data as TransportTypeRow[]) || [];
        setTransportTypeRows(ttRows);
        const idMap: Record<string, string> = {};
        const nameMap: Record<string, string> = {};
        ttRows.forEach((t) => { idMap[t.id] = t.name; nameMap[t.name.toLowerCase()] = t.name; });
        setTransportTypesById(idMap);
        setTransportTypesByName(nameMap);

        const routeIds = ((r.data as RouteRow[]) || []).map((x) => x.id);

        // Assignments (boats)
        let asn: Assignment[] = [];
        let vList: Vehicle[] = [];
        if (routeIds.length) {
          const { data: aData, error: aErr } = await supabase
            .from("route_vehicle_assignments")
            .select("id,route_id,vehicle_id,preferred,is_active")
            .in("route_id", routeIds).eq("is_active", true);
          if (aErr) { setMsg(aErr.message); setAssignments([]); setVehicles([]); setLoading(false); return; }
          asn = (aData as Assignment[]) || [];
          setAssignments(asn);

          const vehicleIds = Array.from(new Set(asn.map((a) => a.vehicle_id)));
          if (vehicleIds.length) {
            const { data: vData, error: vErr } = await supabase
              .from("vehicles")
              .select("id,name,operator_id,type_id,active,minseats,minvalue,maxseatdiscount,maxseats")
              .in("id", vehicleIds).eq("active", true);
            if (vErr) { setMsg(vErr.message); setVehicles([]); }
            else { vList = (vData as Vehicle[]) || []; setVehicles(vList); }
          } else {
            setVehicles([]);
          }
        }

        // Paid orders (window next ~6 months)
        const windowStart = startOfMonth(startOfDay(new Date()));
        const windowEnd = endOfMonth(addMonths(windowStart, 5));
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .gte("journey_date", windowStart.toISOString().slice(0,10))
          .lte("journey_date", windowEnd.toISOString().slice(0,10));
        if (oErr) { setMsg(oErr.message); setOrders([]); }
        else { setOrders((oData as Order[]) || []); }

        // Sold-out keys from DB view
        try {
          const { data: soldData, error: soldErr } = await supabase.from("vw_soldout_keys").select("route_id,journey_date");
          if (soldErr) setSoldOutKeys(new Set());
          else setSoldOutKeys(new Set<string>((soldData ?? []).map((k: any) => `${k.route_id}_${k.journey_date}`)));
        } catch { setSoldOutKeys(new Set()); }

        // Remaining capacity per route/day from DB view
        try {
          const capMap = new Map<string, number>();
          if (routeIds.length) {
            const { data: capRows, error: capErr } = await supabase
              .from("vw_route_day_capacity")
              .select("route_id, ymd, remaining")
              .in("route_id", routeIds)
              .gte("ymd", windowStart.toISOString().slice(0,10))
              .lte("ymd", windowEnd.toISOString().slice(0,10));
            if (!capErr) {
              for (const r of (capRows ?? []) as any[]) capMap.set(`${r.route_id}_${r.ymd}`, Number(r.remaining ?? 0));
            }
          }
          setRemainingByKeyDB(capMap);
        } catch { setRemainingByKeyDB(new Map()); }

      } catch (e: any) {
        setMsg(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [countryId]);
  /* ---------- Derived: verified routes ---------- */
  const verifiedRoutes = useMemo(() => {
    const withAsn = new Set(assignments.map((a) => a.route_id));
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
      .filter((a) => a.route_id === routeId)
      .map((a) => vehicles.find((v) => v && v.id === a.vehicle_id))
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

  /* ---------- Live quotes ---------- */
  const [quotesByRow, setQuotesByRow] = useState<Record<string, UiQuote | null>>({});
  const [quoteErrByRow, setQuoteErrByRow] = useState<Record<string, string | null>>({});
  const inventoryReady = soldOutKeys.size > 0 || (assignments.length > 0 && vehicles.length > 0) || orders.length > 0;

  const [seatSelections, setSeatSelections] = useState<Record<string, number>>({});
  const [lastGoodPriceByRow, setLastGoodPriceByRow] = useState<Record<string, number>>({});
  const [lockedPriceByRow, setLockedPriceByRow] = useState<Record<string, number>>({});
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  useEffect(() => {
    if (!rows.length) {
      if (Object.keys(quotesByRow).length || Object.keys(quoteErrByRow).length) {
        setQuotesByRow({});
        setQuoteErrByRow({});
      }
      return;
    }
    if (loading || !inventoryReady) return;

    const ac = new AbortController();
    (async () => {
      await Promise.all(rows.map(async (r) => {
        const qty = seatSelections[r.key] ?? DEFAULT_SEATS;
        const pinned = quotesByRow[r.key]?.vehicle_id ?? null;
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
          return;
        }
        try {
          const json = await fetchQuoteOnce(r.route.id, r.dateISO, qty, ac.signal, pinned);
          if ("error_code" in json) {
            const extra = json.step || json.details ? ` (${json.step ?? ""}${json.step && json.details ? ": " : ""}${json.details ?? ""})` : "";
            setQuotesByRow((p) => ({ ...p, [r.key]: null }));
            setQuoteErrByRow((p) => ({ ...p, [r.key]: `${json.error_code}${extra}` }));
            return;
          }
          const unitMinor = (json.unit_cents ?? null) != null ? Number(json.unit_cents) : Math.round(Number(json.perSeatAllInC ?? 0) * 100);
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
        }
      }));
    })();

    return () => ac.abort();
  }, [rows, seatSelections, soldOutKeys, remainingByKeyDB, inventoryReady, loading, lastGoodPriceByRow, lockedPriceByRow, quotesByRow, quoteErrByRow]);

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

  // Landing (no country selected)
  if (!countryId) {
    return (
      <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
        {hydrated && !supabase && (
          <Banner>
            Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
          </Banner>
        )}

        <section className="space-y-4">
          <p className="text-lg">
            <strong>Pace Shuttle</strong> offers fractional luxury charter and shuttle services to world-class,
            often inaccessible, luxury destinations.
          </p>
        </section>

        <section>
          <div className="relative w-full overflow-hidden rounded-2xl border">
            <div className="aspect-[16/10] sm:aspect-[21/9]">
              <Image src={HERO_IMG_URL} alt="Pace Shuttle — luxury transfers" fill priority className="object-cover" sizes="100vw" />
            </div>
          </div>
        </section>

        <section className="text-center pt-6">
          <div className="font-semibold">Pace Shuttles is currently operating in the following countries.</div>
          <div>Book your dream arrival today</div>
        </section>

        <section className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.map((c) => {
              const imgUrl = publicImage(c.picture_url);
              return (
                <button
                  key={c.id}
                  className="text-left rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow hover:shadow-md transition"
                  onClick={() => {
                    setCountryId(c.id);
                    setActivePane("date");
                    setFilterDateISO(null);
                    setFilterDestinationId(null);
                    setFilterPickupId(null);
                    setFilterTypeName(null);
                    setCalCursor(startOfMonth(new Date()));
                  }}
                >
                  <div className="relative w-full aspect-[4/3]">
                    {imgUrl ? (
                      <Image src={imgUrl} alt={c.name} fill unoptimized className="object-cover" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    ) : (
                      <div className="h-full w-full bg-neutral-100" />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="mt-1 text-sm text-neutral-600 line-clamp-3">{c.description}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="pt-10">
          <a href="/partners" aria-label="Partner with Pace Shuttles">
            <div className="relative w-full overflow-hidden rounded-2xl border">
              <div className="aspect-[21/9]">
                <Image src={FOOTER_CTA_IMG_URL} alt="Partner with Pace Shuttles" fill className="object-cover" sizes="100vw" />
              </div>
            </div>
          </a>
        </section>
      </div>
    );
  }
  // Planner UI (country selected)
  return (
    <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
      {hydrated && !supabase && (
        <Banner>
          Supabase not configured. Check <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. See <code>window.PaceEnv</code> in devtools.
        </Banner>
      )}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Plan your shuttle</h1>
        <p className="text-neutral-600">Use the tiles below to filter, then pick a journey.</p>
      </header>

      <div className="flex items-center gap-2">
        <button className="rounded-full px-3 py-1 border text-sm" onClick={() => setCountryId("")}>← change country</button>
        {msg && <span className="text-sm text-neutral-600">{msg}</span>}
      </div>

      {/* Filters */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["date","destination","pickup","type"] as const).map((k) => (
            <button
              key={k}
              className={`px-3 py-1 rounded-full border ${activePane === k ? "bg-blue-600 text-white" : ""}`}
              onClick={() => setActivePane((p) => (p === k ? "none" : k))}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
          {(filterDateISO || filterDestinationId || filterPickupId || filterTypeName) && (
            <button
              className="ml-auto px-3 py-1 rounded-full border text-sm"
              onClick={() => { setFilterDateISO(null); setFilterDestinationId(null); setFilterPickupId(null); setFilterTypeName(null); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {activePane === "date" && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <button className="px-3 py-1 border rounded-lg" onClick={() => setCalCursor(addMonths(calCursor, -1))}>←</button>
              <div className="text-lg font-medium" suppressHydrationWarning>{monthLabel}</div>
              <button className="px-3 py-1 border rounded-lg" onClick={() => setCalCursor(addMonths(calCursor, 1))}>→</button>
            </div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs text-neutral-600 mb-1">
              {DOW.map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarDays.map((d, i) => {
                const selected = filterDateISO === d.iso;
                const names = namesByDate.get(d.iso) || [];
                return (
                  <button
                    key={d.iso + i}
                    className={`min-h-[112px] text-left p-2 rounded-xl border transition ${
                      selected ? "bg-blue-600 text-white border-blue-600"
                      : d.inMonth ? "bg-white hover:shadow-sm"
                      : "bg-neutral-50 text-neutral-400"
                    }`}
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
              <div className="mt-3 text-sm text-neutral-700" suppressHydrationWarning>
                Selected: {new Date(filterDateISO + "T12:00:00").toLocaleDateString()}
              </div>
            )}
          </div>
        )}

        {activePane === "destination" && (
          <TilePicker
            title="Choose a destination"
            items={destinations.map((d) => ({ id: d.id, name: d.name, description: d.description ?? "", image: publicImage(d.picture_url) }))}
            onChoose={setFilterDestinationId}
            selectedId={filterDestinationId}
            includeAll={false}
          />
        )}

        {activePane === "pickup" && (
          <TilePicker
            title="Choose a pick-up point"
            items={pickups.map((p) => ({ id: p.id, name: p.name, description: p.description ?? "", image: publicImage(p.picture_url) }))}
            onChoose={setFilterPickupId}
            selectedId={filterPickupId}
            includeAll={false}
          />
        )}

        {activePane === "type" && (
          <TilePicker
            title="Choose a vehicle type"
            items={transportTypeRows.filter((t) => t.is_active !== false).map((t) => ({
              id: t.name, name: t.name, description: t.description ?? "", image: typeImgSrc(t),
            }))}
            onChoose={setFilterTypeName}
            selectedId={filterTypeName}
            includeAll={false}
          />
        )}
      </section>

      {/* Mobile-first Journey Cards */}
      <section className="md:hidden space-y-3">
        {loading ? (
          <div className="p-4 rounded-xl border bg-white">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4 rounded-xl border bg-white">No verified routes for this country in the selected window.</div>
        ) : (
          rows.map((r) => {
            const pu = pickupById(r.route.pickup_id);
            const de = destById(r.route.destination_id);
            const vType = vehicleTypeNameForRoute(r.route.id);
            const q = quotesByRow[r.key];

            const preSoldOut = isSoldOut(r.route.id, r.dateISO);
            const hasLivePrice = !!q?.token;
            const rowSoldOut = preSoldOut || q?.availability === "sold_out";

            const priceDisplay = (lockedPriceByRow[r.key] ?? q?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0);
            const selected = seatSelections[r.key] ?? 2;
            const err = quoteErrByRow[r.key];

            const k = `${r.route.id}_${r.dateISO}`;
            const remaining = (remainingByKeyDB.get(k) ?? remainingSeatsByKey.get(k) ?? 0);
            const overByCapacity = !rowSoldOut && selected > remaining;
            const overMaxAtPrice = q?.max_qty_at_price != null ? selected > q.max_qty_at_price : false;

            return (
              <JourneyCard
                key={r.key}
                pickupName={pu?.name ?? "—"}
                pickupImg={publicImage(pu?.picture_url)}
                destName={de?.name ?? "—"}
                destImg={publicImage(de?.picture_url)}
                dateISO={r.dateISO}
                timeStr={hhmmLocalToDisplay(r.route.pickup_time)}
                durationMins={r.route.approx_duration_mins ?? undefined}
                vehicleType={vType}
                soldOut={rowSoldOut}
                priceLabel={hasLivePrice && !rowSoldOut ? currencyIntPounds(priceDisplay) : "—"}
                lowSeats={(remaining > 0 && remaining <= 5) ? remaining : undefined}
                errorMsg={
                  rowSoldOut ? undefined :
                  overByCapacity ? `Only ${remaining} seat${remaining === 1 ? "" : "s"} left.` :
                  overMaxAtPrice ? `Only ${q?.max_qty_at_price ?? 0} seats available at this price.` :
                  err ?? undefined
                }
                seats={selected}
                onSeatsChange={(n) => handleSeatChange(r.key, n)}
                onContinue={() => handleContinue(r.key, r.route.id)}
                continueDisabled={rowSoldOut || overByCapacity}
              />
            );
          })
        )}
      </section>

      {/* Desktop/tablet table */}
      <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow hidden md:block">
        {loading ? (
          <div className="p-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-4">No verified routes for this country in the selected window.</div>
        ) : (
          <table className="w-full">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left p-3">Pick-up</th>
                <th className="text-left p-3">Destination</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Time</th>
                <th className="text-left p-3">Duration (mins)</th>
                <th className="text-left p-3">Vehicle Type</th>
                <th className="text-right p-3">Seat price</th>
                <th className="text-left p-3">Seats</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.sort((a,b)=>a.dateISO.localeCompare(b.dateISO)).map((r) => {
                const pu = pickupById(r.route.pickup_id);
                const de = destById(r.route.destination_id);
                const vType = vehicleTypeNameForRoute(r.route.id);
                const q = quotesByRow[r.key];

                const preSoldOut = isSoldOut(r.route.id, r.dateISO);
                const hasLivePrice = !!q?.token;
                const rowSoldOut = preSoldOut || q?.availability === "sold_out";

                const priceDisplay = (lockedPriceByRow[r.key] ?? q?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0);
                const selected = seatSelections[r.key] ?? 2;
                const err = quoteErrByRow[r.key];

                const k = `${r.route.id}_${r.dateISO}`;
                const remaining = (remainingByKeyDB.get(k) ?? remainingSeatsByKey.get(k) ?? 0);
                const overByCapacity = !rowSoldOut && selected > remaining;
                const overMaxAtPrice = q?.max_qty_at_price != null ? selected > q.max_qty_at_price : false;
                const showLowSeats = !rowSoldOut && remaining > 0 && remaining <= 5;

                return (
                  <tr key={r.key} className="border-t align-top">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="relative h-10 w-16 overflow-hidden rounded border">
                          <Image src={publicImage(pu?.picture_url) || "/placeholder.png"} alt={pu?.name || "Pick-up"} fill unoptimized className="object-cover" sizes="64px" />
                        </div>
                        <span>{pu?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="relative h-10 w-16 overflow-hidden rounded border">
                          <Image src={publicImage(de?.picture_url) || "/placeholder.png"} alt={de?.name || "Destination"} fill unoptimized className="object-cover" sizes="64px" />
                        </div>
                        <span>{de?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-3" suppressHydrationWarning>{new Date(r.dateISO + "T12:00:00").toLocaleDateString()}</td>
                    <td className="p-3" suppressHydrationWarning>{hhmmLocalToDisplay(r.route.pickup_time)}</td>
                    <td className="p-3">{r.route.approx_duration_mins ?? "—"}</td>
                    <td className="p-3">{vType}</td>
                    <td className="p-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold">
                          {rowSoldOut ? "—" : hasLivePrice ? currencyIntPounds(priceDisplay) : "—"}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {rowSoldOut ? "Sold out" : hasLivePrice ? "Per ticket (incl. tax & fees)" : (err ? `Quote error: ${err}` : "Awaiting live price")}
                        </span>
                        {showLowSeats && !rowSoldOut && (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            Only {remaining} seat{remaining === 1 ? "" : "s"} left
                          </div>
                        )}
                        {!showLowSeats && !overMaxAtPrice && err && !rowSoldOut && (
                          <div className="text-[11px] text-amber-700 mt-0.5">{err}</div>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <select
                        className="border rounded-lg px-2 py-1"
                        value={selected}
                        onChange={(e) => handleSeatChange(r.key, parseInt(e.target.value))}
                        disabled={rowSoldOut}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}</option>))}
                      </select>
                    </td>
                    <td className="p-3">
                      <button
                        className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                        title={
                          rowSoldOut ? "Sold out"
                          : overByCapacity ? `Only ${remaining} seat${remaining === 1 ? "" : "s"} left.`
                          : overMaxAtPrice ? `Only ${q?.max_qty_at_price ?? 0} seats available at this price.`
                          : hasLivePrice ? "Continue" : "Continue (price will be confirmed on next step)"
                        }
                        onClick={() => handleContinue(r.key, r.route.id)}
                        disabled={rowSoldOut || overByCapacity}
                        style={{ backgroundColor: rowSoldOut || overByCapacity ? "#9ca3af" : "#2563eb" }}
                      >
                        {rowSoldOut ? "Sold out" : "Continue"}
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
} // closes HomePage
