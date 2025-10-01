// src/app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const LOGIN_PATH = "/login";

// Landing images — put these in /public or replace with your URLs
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

// --- build a public URL for transport type images only
function typeImgSrc(t: { id: string; picture_url?: string | null }) {
  const p = t.picture_url?.trim();
  if (!p) return undefined;

  // If absolute URL or app-relative path, use as-is
  if (p.startsWith("http://") || p.startsWith("https://") || p.startsWith("/")) return p;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return undefined;

  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET?.trim() || "images").replace(/^\/+|\/+$/g, "");
  // If someone stored a nested path, respect it; otherwise use the canonical folder layout.
  const path = p.includes("/")
    ? p.replace(/^\/+/, "")
    : `transport-types/${t.id}/${p}`;

  // Encode each segment but keep slashes
  const encodedPath = path
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${encodedPath}`;
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
  frequency: string | null;         // e.g. "Every Tuesday", "Daily", "Ad-hoc"
  frequency_rrule?: string | null;  // optional
  season_from?: string | null;      // YYYY-MM-DD
  season_to?: string | null;        // YYYY-MM-DD
  is_active?: boolean | null;
  transport_type?: string | null;   // legacy/fallback text or id/name
};

type Assignment = { id: string; route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null; };
type Vehicle = { id: string; name: string; operator_id?: string | null; type_id?: string | null; active?: boolean | null; minseats?: number | null; minvalue?: number | null; maxseatdiscount?: number | null; };
type TransportTypeRow = { id: string; name: string; description?: string | null; picture_url?: string | null; is_active?: boolean | null; };

type UiQuote = {
  displayPounds: number;
  token: string;
  availability?: "available" | "sold_out" | "no_journey" | "no_vehicles" | "insufficient_capacity_for_party";
  currency?: string;
  vehicle_id?: string | null;
  max_qty_at_price?: number | null;
};

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
  try { const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10)); const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return hhmm || "—"; }
}

function currencyIntPounds(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "£0";
  return `£${Math.ceil(n).toLocaleString("en-GB")}`;
}

/** Combine date ISO + pickup_time to UTC ISO; if pickup_time missing, return null. */
function makeDepartureISO(dateISO: string, pickup_time: string | null | undefined): string | null {
  if (!dateISO || !pickup_time) return null;
  try { return new Date(`${dateISO}T${pickup_time}:00`).toISOString(); } catch { return null; }
}

/* ========================================================================================= */
/* ===== Quotes: one request per row, with diag in dev and AbortController ===== */

const DIAG = process.env.NODE_ENV !== "production" ? "1" : "0";

type QuoteOk = {
  availability:
    | "available"
    | "no_journey"
    | "no_vehicles"
    | "sold_out"
    | "insufficient_capacity_for_party";
  qty: number;
  base_cents: number;
  tax_cents: number;
  fees_cents: number;
  total_cents: number;
  unit_cents?: number;             // NEW, preferred
  perSeatAllInC?: number;          // legacy fallback (pounds float)
  currency?: string;
  vehicle_id?: string | null;      // boat that priced this quote
  max_qty_at_price?: number | null;
  token: string;
};

type QuoteErr = { error_code: string; step?: string; details?: string };

/** Single clean GET using snake_case (matches server). Optional pin to a vehicle. */
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
  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    return { error_code: `non_json_${res.status}`, details: txt.slice(0, 160) };
  }
  return json;
}

/* ========================================================================================= */

export default function HomePage() {
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
          supabase.from("routes").select("*").eq("country_id", countryId).eq("is_active", true).order("created_at", { ascending: false }),
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
        setRoutes(((r.data as RouteRow[]) || []).filter((row) =>
          withinSeason(today, row.season_from ?? null, row.season_to ?? null)
        ));

        const ttRows = (tt.data as TransportTypeRow[]) || [];
        setTransportTypeRows(ttRows);
        const idMap: Record<string, string> = {};
        const nameMap: Record<string, string> = {};
        ttRows.forEach((t) => { idMap[t.id] = t.name; nameMap[t.name.toLowerCase()] = t.name; });
        setTransportTypesById(idMap);
        setTransportTypesByName(nameMap);

        const routeIds = ((r.data as RouteRow[]) || []).map((x) => x.id);
        if (routeIds.length === 0) { setAssignments([]); setVehicles([]); setLoading(false); return; }

        const { data: aData, error: aErr } = await supabase
          .from("route_vehicle_assignments")
          .select("id,route_id,vehicle_id,preferred,is_active")
          .in("route_id", routeIds)
          .eq("is_active", true);

        if (aErr) { setMsg(aErr.message); setAssignments([]); setVehicles([]); setLoading(false); return; }

        const asn = (aData as Assignment[]) || [];
        setAssignments(asn);

        const vehicleIds = Array.from(new Set(asn.map((a) => a.vehicle_id)));
        if (vehicleIds.length) {
          const { data: vData, error: vErr } = await supabase
            .from("vehicles")
            .select("id,name,operator_id,type_id,active,minseats,minvalue,maxseatdiscount")
            .in("id", vehicleIds)
            .eq("active", true);

          if (vErr) { setMsg(vErr.message); setVehicles([]); }
          else { setVehicles((vData as Vehicle[]) || []); }
        } else {
          setVehicles([]);
        }
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

  /* ---------- Generate occurrences (6 months) ---------- */
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
          const iso = d.toISOString().slice(0, 10);
          out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
        }
      } else if (kind.type === "DAILY") {
        for (let d = new Date(windowStart); d <= windowEnd; d = addDays(d, 1)) {
          if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
          if (d.getTime() < startOfDay(nowPlus25h).getTime()) continue;
          const iso = d.toISOString().slice(0, 10);
          out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
        }
      } else {
        if (withinSeason(today, r.season_from ?? null, r.season_to ?? null)) {
          const d = new Date(today);
          if (d.getTime() >= startOfDay(nowPlus25h).getTime()) {
            const iso = d.toISOString().slice(0, 10);
            out.push({ id: `${r.id}_${iso}`, route_id: r.id, dateISO: iso });
          }
        }
      }
    }

    return out;
  }, [verifiedRoutes]);

  /* ---------- lookups ---------- */
  const pickupById = (id: string | null | undefined) => pickups.find((p) => p.id === id) || null;
  const destById = (id: string | null | undefined) => destinations.find((d) => d.id === id) || null;

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

    if (vs.length) {
      const v = vs[0];
      if (v?.type_id) {
        const mapped = transportTypesById[String(v.type_id)];
        if (mapped) return mapped;
      }
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

  /* ---------- Filters -> rows ---------- */
  const filteredOccurrences = useMemo(() => {
    const nowPlus25h = addHours(new Date(), MIN_LEAD_HOURS);
    const minISO = startOfDay(nowPlus25h).toISOString().slice(0, 10);

    let occ = occurrences.slice();
    occ = occ.filter((o) => o.dateISO >= minISO);

    if (filterDateISO) {
      occ = occ.filter((o) => o.dateISO === filterDateISO);
    }
    if (filterDestinationId) {
      const keepRoute = new Set(verifiedRoutes.filter((r) => r.destination_id === filterDestinationId).map((r) => r.id));
      occ = occ.filter((o) => keepRoute.has(o.route_id));
    }
    if (filterPickupId) {
      const keepRoute = new Set(verifiedRoutes.filter((r) => r.pickup_id === filterPickupId).map((r) => r.id));
      occ = occ.filter((o) => keepRoute.has(o.route_id));
    }
    if (filterTypeName) {
      const wanted = filterTypeName.toLowerCase();
      const keepRoute = new Set(
        verifiedRoutes
          .filter((r) => vehicleTypeNameForRoute(r.id).toLowerCase() === wanted)
          .map((r) => r.id)
      );
      occ = occ.filter((o) => keepRoute.has(o.route_id));
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
        if (!r) return null;
        return { key: o.id, route: r, dateISO: o.dateISO };
      })
      .filter(Boolean)
      .sort((a, b) => a!.dateISO.localeCompare(b!.dateISO)) as RowOut[];
  }, [filteredOccurrences, verifiedRoutes]);

  const rows = useMemo(() => rowsAll.slice(0, MAX_ROWS), [rowsAll]);

  /* ---------- Live quotes ---------- */
  const [quotesByRow, setQuotesByRow] = useState<Record<string, UiQuote | null>>({});
  const [quoteErrByRow, setQuoteErrByRow] = useState<Record<string, string | null>>({});
  const [seatSelections, setSeatSelections] = useState<Record<string, number>>({});
  // NEW: remember last good visible price (keeps the UI stable)
  const [lastGoodPriceByRow, setLastGoodPriceByRow] = useState<Record<string, number>>({});

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  // load quotes for visible rows (single GET per row, with AbortController)
  useEffect(() => {
    // If no rows, only clear state if there was something to clear
    if (!rows.length) {
      if (Object.keys(quotesByRow).length || Object.keys(quoteErrByRow).length) {
        setQuotesByRow({});
        setQuoteErrByRow({});
      }
      return;
    }

    const ac = new AbortController();

    const run = async () => {
      await Promise.all(
        rows.map(async (r) => {
          const qty = seatSelections[r.key] ?? DEFAULT_SEATS;
          // read the last pinned vehicle id, but DO NOT depend on quotesByRow in deps
          const pinned = quotesByRow[r.key]?.vehicle_id ?? null;

          try {
            const json = await fetchQuoteOnce(r.route.id, r.dateISO, qty, ac.signal, pinned);

            if ("error_code" in json) {
              const extra =
                json.step || json.details
                  ? ` (${json.step ?? ""}${json.step && json.details ? ": " : ""}${json.details ?? ""})`
                  : "";
              setQuotesByRow((p) => ({ ...p, [r.key]: null }));
              setQuoteErrByRow((p) => ({ ...p, [r.key]: `${json.error_code}${extra}` }));
              // keep last good price as-is
              return;
            }

            const unitMinor =
              (json.unit_cents ?? null) != null
                ? Number(json.unit_cents)
                : Math.round(Number(json.perSeatAllInC ?? 0) * 100);

            if (json.max_qty_at_price != null && qty > json.max_qty_at_price) {
              setQuoteErrByRow((p) => ({
                ...p,
                [r.key]: `Only ${json.max_qty_at_price} seats available at this price.`,
              }));
            } else {
              setQuoteErrByRow((p) => ({ ...p, [r.key]: null }));
            }

            const displayPounds = Math.ceil(unitMinor / 100);

            setQuotesByRow((p) => ({
              ...p,
              [r.key]: {
                displayPounds,
                token: json.token,
                availability: json.availability,
                currency: json.currency ?? "GBP",
                vehicle_id: json.vehicle_id ?? pinned ?? null,
                max_qty_at_price: json.max_qty_at_price ?? null,
              },
            }));
            // refresh the locked/visible price only on a successful quote
            setLastGoodPriceByRow((p) => ({ ...p, [r.key]: displayPounds }));
          } catch (e: any) {
            setQuotesByRow((p) => ({ ...p, [r.key]: null }));
            setQuoteErrByRow((p) => ({ ...p, [r.key]: e?.message ?? "network" }));
            // keep last good price as-is
          }
        })
      );
    };

    run();
    return () => ac.abort();
    // IMPORTANT: do NOT include quotesByRow here; that caused the loop
  }, [rows, seatSelections]);  // <- dependency array

  const handleSeatChange = async (rowKey: string, n: number) => {
    setSeatSelections((prev) => ({ ...prev, [rowKey]: n }));
    const row = rows.find((r) => r.key === rowKey);
    if (!row) return;

    const pinned = quotesByRow[rowKey]?.vehicle_id ?? null;

    const ac = new AbortController();
    try {
      const json = await fetchQuoteOnce(row.route.id, row.dateISO, n, ac.signal, pinned);
      if ("error_code" in json) {
        const extra =
          json.step || json.details
            ? ` (${json.step ?? ""}${json.step && json.details ? ": " : ""}${json.details ?? ""})`
            : "";
        setQuotesByRow((p) => ({ ...p, [rowKey]: null }));
        setQuoteErrByRow((p) => ({ ...p, [rowKey]: `${json.error_code}${extra}` }));
        // keep last good price
        return;
      }

      const unitMinor =
        (json.unit_cents ?? null) != null
          ? Number(json.unit_cents)
          : Math.round(Number(json.perSeatAllInC ?? 0) * 100);

      if (json.max_qty_at_price != null && n > json.max_qty_at_price) {
        setQuoteErrByRow((p) => ({
          ...p,
          [rowKey]: `Only ${json.max_qty_at_price} seats available at this price.`,
        }));
      } else {
        setQuoteErrByRow((p) => ({ ...p, [rowKey]: null }));
      }

      const displayPounds = Math.ceil(unitMinor / 100);

      setQuotesByRow((p) => ({
        ...p,
        [rowKey]: {
          displayPounds,
          token: json.token,
          availability: json.availability,
          currency: json.currency ?? "GBP",
          vehicle_id: json.vehicle_id ?? pinned ?? null,
          max_qty_at_price: json.max_qty_at_price ?? null,
        },
      }));
      // update locked price only on successful quote
      setLastGoodPriceByRow((p) => ({ ...p, [rowKey]: displayPounds }));
    } catch (e: any) {
      setQuotesByRow((p) => ({ ...p, [rowKey]: null }));
      setQuoteErrByRow((p) => ({ ...p, [rowKey]: e?.message ?? "network" }));
      // keep last good price
    }
  };

  const handleContinue = async (rowKey: string, routeId: string) => {
    if (!supabase) { alert("Supabase client is not configured."); return; }

    const row = rows.find((r) => r.key === rowKey);
    const q   = quotesByRow[rowKey];
    if (!row) { alert("Missing row data."); return; }

    const seats = seatSelections[rowKey] ?? DEFAULT_SEATS;
    const departure_ts = makeDepartureISO(row.dateISO, row.route.pickup_time);

    // Re-confirm price/availability once before creating the quote_intent.
    try {
      const confirm = await fetchQuoteOnce(routeId, row.dateISO, seats, undefined, q?.vehicle_id ?? null);
      if ("error_code" in confirm) {
        alert(`Live quote check failed: ${confirm.error_code}${confirm.details ? ` — ${confirm.details}` : ""}`);
        return;
      }
      if (confirm.availability === "sold_out") {
        alert("Sorry, this departure has just sold out.");
        return;
      }
      if (confirm.max_qty_at_price != null && seats > confirm.max_qty_at_price) {
        alert(`Only ${confirm.max_qty_at_price} seats are available at this price. Please lower the seat count or choose another date.`);
        return;
      }
    } catch (e: any) {
      alert(e?.message ?? "Could not re-confirm the live price. Please try again.");
      return;
    }

    try {
      const { data, error } = await supabase
        .from("quote_intents")
        .insert({
          route_id: routeId,
          date_iso: row.dateISO, // "YYYY-MM-DD"
          departure_ts,          // optional helper for checkout
          seats,
          per_seat_all_in: (quotesByRow[rowKey]?.displayPounds ?? lastGoodPriceByRow[rowKey] ?? null),
          currency: q?.currency ?? "GBP",
          quote_token: q?.token ?? null,
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

  // ---------- Landing (no country selected) ----------
  if (!countryId) {
    return (
      <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
        {/* Intro copy */}
        <section className="space-y-4">
          <p className="text-lg">
            <strong>Pace Shuttle</strong> offers fractional luxury charter and shuttle services to world-class,
            often inaccessible, luxury destinations.
          </p>
          <p className="text-lg">
            You pay only for your seats—no need to charter the entire craft for your grand restaurant arrival or beach day.
          </p>
        </section>

        {/* Hero image */}
        <section>
          <img
            src={HERO_IMG_URL}
            alt="Pace Shuttle — luxury transfers"
            className="w-full rounded-2xl object-cover border"
          />
        </section>

        {/* Heading above country tiles */}
        <section className="text-center pt-6">
          <div className="font-semibold">Pace Shuttles is currently operating in the following countries.</div>
          <div>Book your dream arrival today</div>
        </section>

        {/* Country tiles (centered, auto-fit, tidy) */}
        <section className="mx-auto max-w-5xl">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {countries.map((c) => (
              <button
                key={c.id}
                className="text-left rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow hover:shadow-md transition p-4"
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
                {c.picture_url ? (
                  <img src={c.picture_url} alt={c.name} className="mb-3 h-40 w-full object-cover rounded-xl" />
                ) : (<div className="mb-3 h-40 w-full rounded-xl bg-neutral-100" />)}
                <div className="font-medium">{c.name}</div>
                {c.description && <div className="mt-1 text-sm text-neutral-600 line-clamp-3">{c.description}</div>}
              </button>
            ))}
          </div>
        </section>

        {/* Footer CTA image linking to /partners */}
        <section className="pt-10">
          <a href="/partners" aria-label="Partner with Pace Shuttles">
            <img
              src={FOOTER_CTA_IMG_URL}
              alt="Partner with Pace Shuttles"
              className="w-full rounded-2xl object-cover border"
            />
          </a>
        </section>
      </div>
    );
  }

  // ---------- Existing planner UI (country selected) ----------
  return (
    <div className="space-y-8 px-4 py-6 mx-auto max-w-[1120px]">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Plan your shuttle</h1>
        <p className="text-neutral-600">
          Select from the routes below using the filters to help tailor your experience.
        </p>
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
              <div className="text-lg font-medium">{monthLabel}</div>
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
                    className={`min-h-[128px] text-left p-2 rounded-xl border transition ${selected ? "bg-blue-600 text-white border-blue-600" : d.inMonth ? "bg-white hover:shadow-sm" : "bg-neutral-50 text-neutral-400"}`}
                    onClick={() => setFilterDateISO(d.iso)}
                  >
                    <div className="text-xs opacity-70">{d.label}</div>
                    <div className="mt-1 space-y-1">
                      {names.map((n, idx) => (
                        <div key={idx} className="text-[11px] leading-snug whitespace-normal break-words">
                          {n}
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
            {filterDateISO && (
              <div className="mt-3 text-sm text-neutral-700">
                Selected: {new Date(filterDateISO + "T12:00:00").toLocaleDateString()}
              </div>
            )}
          </div>
        )}

        {activePane === "destination" && (
          <TilePicker
            title="Choose a destination"
            items={destinations.map((d) => ({
              id: d.id, name: d.name, description: d.description ?? "", image: d.picture_url ?? undefined
            }))}
            onChoose={setFilterDestinationId}
            selectedId={filterDestinationId}
            includeAll={false}
          />
        )}

        {activePane === "pickup" && (
          <TilePicker
            title="Choose a pick-up point"
            items={pickups.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description ?? "",
              image: p.picture_url ?? undefined,
            }))}
            onChoose={setFilterPickupId}
            selectedId={filterPickupId}
            includeAll={false}
          />
        )}

        {activePane === "type" && (
          <TilePicker
            title="Choose a vehicle type"
            items={transportTypeRows
              .filter((t) => t.is_active !== false)
              .map((t) => ({
                id: t.name,
                name: t.name,
                description: t.description ?? "",
                image: typeImgSrc(t),
              }))}
            onChoose={setFilterTypeName}
            selectedId={filterTypeName}
            includeAll={false}
          />
        )}
      </section>

      {/* Journeys table */}
      <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
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
              {rows.map((r) => {
                const pu = pickupById(r.route.pickup_id);
                const de = destById(r.route.destination_id);
                const vType = vehicleTypeNameForRoute(r.route.id);
                const q = quotesByRow[r.key];
                const hasLivePrice = !!q?.token;
                // LOCKED visible price: never falls back to £0
                const priceDisplay =
                  (q?.displayPounds ?? lastGoodPriceByRow[r.key] ?? 0);
                const selected = seatSelections[r.key] ?? DEFAULT_SEATS;
                const err = quoteErrByRow[r.key];
                const isSoldOut = q?.availability === "sold_out";
                const overMaxAtPrice =
                  q?.max_qty_at_price != null ? selected > q.max_qty_at_price : false;

                return (
                  <tr key={r.key} data-rowkey={r.key} ref={(el) => { rowRefs.current[r.key] = el }} className="border-t align-top">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {pu?.picture_url ? (<img src={pu.picture_url} alt={pu.name} className="h-10 w-16 object-cover rounded border" />) : (<div className="h-10 w-16 rounded border bg-neutral-100" />)}
                        <span>{pu?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {de?.picture_url ? (<img src={de.picture_url} alt={de?.name ?? "Destination"} className="h-10 w-16 object-cover rounded border" />) : (<div className="h-10 w-16 rounded border bg-neutral-100" />)}
                        <span>{de?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-3">{new Date(r.dateISO + "T12:00:00").toLocaleDateString()}</td>
                    <td className="p-3">{hhmmLocalToDisplay(r.route.pickup_time)}</td>
                    <td className="p-3">{r.route.approx_duration_mins ?? "—"}</td>
                    <td className="p-3">{vType}</td>
                    <td className="p-3 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold">{currencyIntPounds(priceDisplay)}</span>
                        <span className="text-xs text-neutral-500">
                          {isSoldOut
                            ? "Sold out"
                            : hasLivePrice
                              ? "Per ticket (incl. tax & fees)"
                              : (err ? `Quote error: ${err}` : "Awaiting live price")}
                        </span>
                        {/* Soft guard message (priority over generic quote error) */}
                        {overMaxAtPrice && (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            Only {q?.max_qty_at_price} seats available at this price.
                          </div>
                        )}
                        {!overMaxAtPrice && err && (
                          <div className="text-[11px] text-amber-700 mt-0.5">{err}</div>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <select
                        className="border rounded-lg px-2 py-1"
                        value={selected}
                        onChange={(e) => handleSeatChange(r.key, parseInt(e.target.value))}
                        disabled={isSoldOut}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}</option>))}
                      </select>
                    </td>
                    <td className="p-3">
                      <button
                        className="px-3 py-2 rounded-lg text-white hover:opacity-90 transition"
                        title={
                          isSoldOut
                            ? "Sold out"
                            : overMaxAtPrice
                              ? `Only ${q?.max_qty_at_price ?? 0} seats available at this price.`
                              : hasLivePrice ? "Continue" : "Continue (price will be confirmed on next step)"
                        }
                        onClick={() => handleContinue(r.key, r.route.id)}
                        disabled={isSoldOut}
                        style={{
                          backgroundColor: isSoldOut ? "#9ca3af" : "#2563eb"
                        }}
                      >
                        {isSoldOut ? "Sold out" : "Continue"}
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

/* ---------- Tile picker ---------- */
function TilePicker({
  title,
  items,
  selectedId,
  onChoose,
  includeAll = false,
}: {
  title: string;
  items: { id: string; name: string; description?: string; image?: string }[];
  selectedId: string | null;
  onChoose: (id: string | null) => void;
  includeAll?: boolean;
}) {
  return (
    <div className="border-t pt-4">
      <div className="mb-3 text-sm text-neutral-700">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {includeAll && (
          <button className={`text-left rounded-2xl border bg-white p-3 hover:shadow-sm transition ${!selectedId ? "ring-2 ring-blue-600" : ""}`} onClick={() => onChoose(null)}>
            <div className="font-medium">All</div>
            <div className="text-xs text-neutral-600 mt-1">No filter</div>
          </button>
        )}
        {items.map((it) => (
          <button key={it.id} className={`text-left rounded-2xl border bg-white overflow-hidden p-0 hover:shadow-sm transition ${selectedId === it.id ? "ring-2 ring-blue-600" : ""}`} onClick={() => onChoose(it.id)}>
            {it.image ? (<img src={it.image} alt={it.name} className="h-28 w-full object-cover" />) : (<div className="h-28 w-full bg-neutral-100" />)}
            <div className="p-3">
              <div className="font-medium">{it.name}</div>
              {it.description && <div className="text-xs text-neutral-600 mt-1 line-clamp-3">{it.description}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
