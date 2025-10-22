// app/book/date/page.tsx
"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import WizardHeader from "@/components/WizardHeader";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Dest = { id: string; name: string; country_id: string | null; picture_url?: string | null; description?: string | null; url?: string | null; gift?: string | null; wet_or_dry?: "wet" | "dry" | null; };
type Pickup = { id: string; name: string; country_id: string; picture_url?: string | null; description?: string | null; };
type TransportType = { id: string; name: string; is_active?: boolean | null };
type JourneyType = { id: string; name: string }; // from journey_types

type RouteRow = {
  id: string;
  route_name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  pickup_time: string | null;
  frequency: string | null;
  season_from?: string | null;
  season_to?: string | null;
  is_active?: boolean | null;
};
type Assignment = { id: string; route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null; };
type Vehicle = {
  id: string;
  name: string;
  operator_id?: string | null;
  type_id?: string | null; // may be UUID of journey_types, or a plain name like "Helicopter"
  active?: boolean | null;
  minseats?: number | null;
  maxseats?: number | null;
  minvalue?: number | null;
  min_val_threshold?: number | null;
  maxseatdiscount?: number | null;
  preferred?: boolean | null;
};
type Operator = { id: string; csat?: number | null };

/* ---------- Helpers ---------- */
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

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
  const s = freq.toLowerCase().trim();
  if (s.includes("daily")) return { type: "DAILY" };
  const weekdayIdx = DAY_NAMES.findIndex((d) => s.includes(d.toLowerCase()));
  if (weekdayIdx >= 0) return { type: "WEEKLY", weekday: weekdayIdx };
  return { type: "ADHOC" };
}
function hhmmLocalToDisplay(hhmm: string | null | undefined) {
  if (!hhmm) return "—";
  try { const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10)); const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return hhmm; }
}
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* ---------- Pricing ---------- */
type Bucket = {
  vehicle_id: string;
  operator_id: string | null | undefined;
  csat: number;
  baseSeat: number;
  maxseats: number;
  minvalue: number;
  maxseatdiscount: number;
  rvaPreferred: boolean;
  vehPreferred: boolean;
  allocated: number;
  vehicleNet: number;
};
const EPS = 1e-6;

function pickNextBucketIndex(buckets: Bucket[], usedOps: Set<string>): number {
  const open = buckets.filter(b => b.allocated < b.maxseats);
  if (open.length === 0) return -1;
  open.sort((a,b) => {
    if (Math.abs(a.baseSeat - b.baseSeat) > EPS) return a.baseSeat - b.baseSeat;
    if (a.csat !== b.csat) return (b.csat ?? 0) - (a.csat ?? 0);
    if (a.rvaPreferred !== b.rvaPreferred) return (a.rvaPreferred ? -1 : 1);
    if (a.vehPreferred !== b.vehPreferred) return (a.vehPreferred ? -1 : 1);
    return 0;
  });
  const minBase = open[0].baseSeat;
  const tiedCheapest = open.filter(b => Math.abs(b.baseSeat - minBase) <= EPS);
  const notUsed = tiedCheapest.filter(b => b.operator_id && !usedOps.has(b.operator_id));
  if (notUsed.length > 0) {
    notUsed.sort((a,b) => {
      if (a.csat !== b.csat) return (b.csat ?? 0) - (a.csat ?? 0);
      if (a.rvaPreferred !== b.rvaPreferred) return (a.rvaPreferred ? -1 : 1);
      if (a.vehPreferred !== b.vehPreferred) return (a.vehPreferred ? -1 : 1);
      return 0;
    });
    const chosen = notUsed[0];
    return buckets.findIndex(b => b.vehicle_id === chosen.vehicle_id);
  }
  const chosen = open[0];
  return buckets.findIndex(b => b.vehicle_id === chosen.vehicle_id);
}

function applyTaxFees(seatNet: number, tax: number, fees: number): number {
  const taxDue  = seatNet * (tax || 0);
  const feesDue = (seatNet + taxDue) * (fees || 0);
  return seatNet + taxDue + feesDue;
}

/* =========================
   SUSPENSE-WRAPPED VERSION
   ========================= */

function Inner() {
  const params = useSearchParams();
  const router = useRouter();

  const countryId = params.get("country_id") || "";
  const destinationId = params.get("destination_id") || "";
  const journeyTypeIdParam = params.get("journey_type_id") || ""; // may be UUID or a lowercase name key

  const [msg, setMsg] = useState<string | null>(null);

  const [dest, setDest] = useState<Dest | null>(null);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]); // NEW: id→name map
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [operatorsById, setOperatorsById] = useState<Record<string, Operator>>({});
  const [taxRate, setTaxRate] = useState(0);
  const [feesRate, setFeesRate] = useState(0);

  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);
  const [calCursor, setCalCursor] = useState<Date>(startOfMonth(new Date()));
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [occurrencePrice, setOccurrencePrice] = useState<Record<string, number | null>>({});

  // ---- URL helpers for setting/removing the type param ----
  function setQueryParam(key: string, value?: string) {
    const next = new URLSearchParams(params.toString());
    if (value) {
      next.set(key, value);
      if (key === "journey_type_id") next.set("transport_type_id", value); // keep legacy param
    } else {
      next.delete(key);
      if (key === "journey_type_id") next.delete("transport_type_id");
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  // sanity
  useEffect(() => {
    if (!countryId || !destinationId) { router.replace("/book/country"); }
  }, [countryId, destinationId, router]);

  // base reads
  useEffect(() => {
    (async () => {
      const [dRes, pRes, rRes, tRes, jtRes] = await Promise.all([
        sb.from("destinations").select("id,name,country_id,picture_url,description,url,gift,wet_or_dry").eq("id", destinationId).limit(1),
        sb.from("pickup_points").select("id,name,country_id,picture_url,description").eq("country_id", countryId).order("name"),
        sb.from("routes").select("*").eq("country_id", countryId).eq("destination_id", destinationId).eq("is_active", true),
        sb.from("transport_types").select("id,name,is_active"),
        sb.from("journey_types").select("id,name"),
      ]);
      if (dRes.error || pRes.error || rRes.error || tRes.error || jtRes.error) {
        setMsg(dRes.error?.message || pRes.error?.message || rRes.error?.message || tRes.error?.message || jtRes.error?.message || "Load failed");
        return;
      }

      setDest((dRes.data?.[0] as Dest) || null);
      setPickups((pRes.data as Pickup[]) || []);
      setTransportTypes((tRes.data as TransportType[]) || []);
      setJourneyTypes((jtRes.data as JourneyType[]) || []);

      const today = startOfDay(new Date());
      const activeInSeasonRoutes = ((rRes.data as RouteRow[]) || []).filter((row) =>
        withinSeason(today, row.season_from ?? null, row.season_to ?? null)
      );
      setRoutes(activeInSeasonRoutes);

      // tax/fees
      try {
        const { data } = await sb.from("tax_fees").select("tax,fees").limit(1);
        if (data?.length) {
          setTaxRate(Number(data[0].tax || 0));
          setFeesRate(Number(data[0].fees || 0));
        } else { setTaxRate(0); setFeesRate(0); }
      } catch { setTaxRate(0); setFeesRate(0); }
    })();
  }, [countryId, destinationId]);

  // assignments + vehicles limited to these routes
  useEffect(() => {
    (async () => {
      const routeIds = routes.map(r => r.id);
      if (!routeIds.length) { setAssignments([]); setVehicles([]); return; }

      const { data: aData, error: aErr } = await sb
        .from("route_vehicle_assignments")
        .select("id,route_id,vehicle_id,preferred,is_active")
        .in("route_id", routeIds)
        .eq("is_active", true);
      if (aErr) { setMsg(aErr.message); setAssignments([]); setVehicles([]); return; }
      const asn = (aData as Assignment[]) || [];
      setAssignments(asn);

      const vehicleIds = Array.from(new Set(asn.map(a => a.vehicle_id)));
      if (!vehicleIds.length) { setVehicles([]); return; }
      const { data: vData, error: vErr } = await sb
        .from("vehicles")
        .select("id,name,operator_id,type_id,active,minseats,maxseats,minvalue,min_val_threshold,maxseatdiscount,preferred")
        .in("id", vehicleIds)
        .eq("active", true);
      if (vErr) { setMsg(vErr.message); setVehicles([]); return; }
      setVehicles((vData as Vehicle[]) || []);
    })();
  }, [routes]);

  // operators for CSAT
  useEffect(() => {
    (async () => {
      const ids = Array.from(new Set(vehicles.map(v => v.operator_id).filter(Boolean))) as string[];
      if (!ids.length) { setOperatorsById({}); return; }
      try {
        const { data } = await sb.from("operators").select("id,csat").in("id", ids);
        const map: Record<string, Operator> = {};
        (data as Operator[] || []).forEach(op => { map[op.id] = op; });
        setOperatorsById(map);
      } catch { setOperatorsById({}); }
    })();
  }, [vehicles]);

  // name lookup for journey type UUIDs
  const jtNameById = useMemo(() => {
    const m = new Map<string, string>();
    journeyTypes.forEach(j => m.set(j.id, j.name));
    transportTypes.forEach(t => {
      if (!m.has(t.id)) m.set(t.id, t.name);
    });
    return m;
  }, [journeyTypes, transportTypes]);

  // Normalize a vehicle's type_id to a comparable key:
  //  - if UUID → return UUID
  //  - otherwise → return lowercased name
  function vehicleTypeKey(v: Vehicle): string | null {
    const raw = (v.type_id || "").trim();
    if (!raw) return null;
    if (/^[0-9a-f-]{36}$/i.test(raw)) return raw; // UUID
    return raw.toLowerCase();                      // name stored in vehicles
  }

  // Resolve a display name for a comparable key
  function typeNameFromKey(key: string): string {
    if (/^[0-9a-f-]{36}$/i.test(key)) return jtNameById.get(key) || key;
    // name-key → prettify
    return key.replace(/\b\w/g, s => s.toUpperCase());
  }

  // Build unique type options from current verified context
  const typeOptions = useMemo(() => {
    const vById = new Map(vehicles.map(v => [v.id, v]));
    const keys = new Map<string, string>(); // key → display name
    assignments.forEach(a => {
      const v = vById.get(a.vehicle_id);
      if (!v?.active) return;
      const key = vehicleTypeKey(v);
      if (!key) return;
      if (!keys.has(key)) keys.set(key, typeNameFromKey(key));
    });
    return Array.from(keys, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, vehicles, jtNameById]);

  // ---------- VERIFIED ROUTES (respects journey_type_id) ----------
  const verifiedRoutes = useMemo(() => {
    const vById = new Map(vehicles.map(v => [v.id, v]));
    const selected = journeyTypeIdParam.trim();
    const selectedIsUUID = /^[0-9a-f-]{36}$/i.test(selected);
    const selectedName = selectedIsUUID ? (jtNameById.get(selected)?.trim().toLowerCase() || "") : selected.toLowerCase();

    const ok = new Set<string>();
    assignments.forEach(a => {
      const v = vById.get(a.vehicle_id);
      if (!v?.active) return;

      if (selected) {
        const vKey = vehicleTypeKey(v);
        if (!vKey) return;

        if (selectedIsUUID) {
          // accept exact UUID match OR UUID→name match
          if (vKey !== selected) {
            const vName = /^[0-9a-f-]{36}$/i.test(vKey) ? (jtNameById.get(vKey)?.trim().toLowerCase() || "") : vKey;
            if (!vName || vName !== selectedName) return;
          }
        } else {
          // selected is a name-key
          const cmp = /^[0-9a-f-]{36}$/i.test(vKey) ? (jtNameById.get(vKey)?.trim().toLowerCase() || "") : vKey;
          if (!cmp || cmp !== selectedName) return;
        }
      }

      ok.add(a.route_id);
    });
    return routes.filter(r => ok.has(r.id));
  }, [routes, assignments, vehicles, journeyTypeIdParam, jtNameById]);

  const availablePickups = useMemo(() => {
    const keep = new Set<string>();
    verifiedRoutes.forEach(r => { if (r.pickup_id) keep.add(r.pickup_id); });
    return pickups.filter(p => keep.has(p.id));
  }, [verifiedRoutes, pickups]);

  // auto-select single pickup
  useEffect(() => {
    if (!selectedPickupId && availablePickups.length === 1) {
      setSelectedPickupId(availablePickups[0].id);
    }
  }, [availablePickups, selectedPickupId]);

  // thumbs
  useEffect(() => {
    let off = false;
    (async () => {
      const want: [string, string | null][] = [];
      availablePickups.forEach(p => want.push([`pu_${p.id}`, p.picture_url ?? null]));
      if (dest) want.push([`dest_${dest.id}`, dest.picture_url ?? null]);
      const entries = await Promise.all(want.map(async ([k, v]) => [k, await resolveStorageUrl(v)]));
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => { off = true; };
  }, [availablePickups, dest]);

  // occurrences (for current + next month)
  type Occurrence = { id: string; route: RouteRow; dateISO: string };
  const occurrences: Occurrence[] = useMemo(() => {
    const today = startOfDay(new Date());
    const windowStart = startOfMonth(today);
    const windowEnd = endOfMonth(addMonths(today, 1));

    const matchFilters = (r: RouteRow): boolean => {
      if (r.destination_id !== destinationId) return false;
      if (selectedPickupId && r.pickup_id !== selectedPickupId) return false;
      return true;
    };

    const out: Occurrence[] = [];
    verifiedRoutes.forEach(r => {
      if (!matchFilters(r)) return;
      const kind = parseFrequency(r.frequency);
      if (kind.type === "WEEKLY") {
        const s = new Date(windowStart);
        const diff = (kind.weekday - s.getDay() + 7) % 7;
        s.setDate(s.getDate() + diff);
        for (let d = new Date(s); d <= windowEnd; d = addDays(d, 7)) {
          if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
          const iso = d.toISOString().slice(0,10);
          out.push({ id: `${r.id}_${iso}`, route: r, dateISO: iso });
        }
      } else if (kind.type === "DAILY") {
        for (let d = new Date(windowStart); d <= windowEnd; d = addDays(d, 1)) {
          if (!withinSeason(d, r.season_from ?? null, r.season_to ?? null)) continue;
          const iso = d.toISOString().slice(0,10);
          out.push({ id: `${r.id}_${iso}`, route: r, dateISO: iso });
        }
      } else {
        if (withinSeason(today, r.season_from ?? null, r.season_to ?? null)) {
          const iso = today.toISOString().slice(0,10);
          out.push({ id: `${r.id}_${iso}`, route: r, dateISO: iso });
        }
      }
    });

    out.sort((a,b) => {
      const c = a.dateISO.localeCompare(b.dateISO);
      if (c !== 0) return c;
      const at = (a.route.pickup_time || ""); const bt = (b.route.pickup_time || "");
      return at.localeCompare(bt);
    });

    return out;
  }, [verifiedRoutes, destinationId, selectedPickupId]);

  // pricing helpers (ported)
  async function fetchBookedSeatsByDate(routeId: string, targetISO: string): Promise<number> {
    try {
      const { data, error } = await sb.from("bookings").select("*").eq("route_id", routeId);
      if (error || !data) return 0;
      let sum = 0;
      (data as any[]).forEach(row => {
        if (row.status && String(row.status).toLowerCase().includes("cancel")) return;
        if ("departure_date" in row && row.departure_date) {
          if (row.departure_date === targetISO) sum += Number(row.seats || 0);
          return;
        }
        if ("departure_at" in row && row.departure_at) {
          const iso = new Date(row.departure_at).toISOString().slice(0,10);
          if (iso === targetISO) sum += Number(row.seats || 0);
          return;
        }
      });
      return sum;
    } catch { return 0; }
  }

  function buildBucketsForRoute(routeId: string) {
    const asn = assignments.filter(a => a.route_id === routeId);
    const vById = new Map(vehicles.map(v => [v.id, v]));
    const buckets: Bucket[] = [];
    asn.forEach(a => {
      const v = vById.get(a.vehicle_id);
      if (!v) return;
      const minseats = Number(v.minseats ?? 0);
      const maxseats = Number(v.maxseats ?? 0);
      const minvalue = Number(v.minvalue ?? 0);
      if (!minseats || !maxseats || !minvalue) return;

      const baseSeat = minvalue / minseats;
      const op = (v.operator_id && operatorsById[v.operator_id]) || undefined;
      buckets.push({
        vehicle_id: v.id,
        operator_id: v.operator_id,
        csat: Number(op?.csat ?? 0),
        baseSeat,
        maxseats,
        minvalue,
        maxseatdiscount: Number(v.maxseatdiscount ?? 0),
        rvaPreferred: false,
        vehPreferred: !!v.preferred,
        allocated: 0,
        vehicleNet: 0,
      });
    });
    return buckets;
  }

  async function computeNextSeatUserPrice(routeId: string, dateISO: string): Promise<number | null> {
    const buckets = buildBucketsForRoute(routeId);
    if (!buckets.length) return null;

    const alreadyBooked = await fetchBookedSeatsByDate(routeId, dateISO);
    let seatsToPlace = Math.max(0, alreadyBooked);

    const usedOps = new Set<string>();
    while (seatsToPlace > 0) {
      const idx = pickNextBucketIndex(buckets, usedOps);
      if (idx < 0) break;
      const b = buckets[idx];
      const seatNet = (b.vehicleNet + b.baseSeat < b.minvalue - EPS)
        ? b.baseSeat
        : b.baseSeat * (1 - b.maxseatdiscount);
      b.vehicleNet += seatNet;
      b.allocated += 1;
      if (b.operator_id) usedOps.add(b.operator_id);
      seatsToPlace -= 1;
    }

    const idx = pickNextBucketIndex(buckets, usedOps);
    if (idx < 0) return null;

    const b = buckets[idx];
    const nextSeatNet = (b.vehicleNet + b.baseSeat < b.minvalue - EPS)
      ? b.baseSeat
      : b.baseSeat * (1 - b.maxseatdiscount);

    const user = applyTaxFees(nextSeatNet, taxRate, feesRate);
    return Math.round(user * 100) / 100;
  }

  // calendar price cache
  useEffect(() => {
    let off = false;
    (async () => {
      if (!occurrences.length) { setOccurrencePrice({}); return; }
      const entries: [string, number | null][] = [];
      for (const o of occurrences) {
        const price = await computeNextSeatUserPrice(o.route.id, o.dateISO);
        if (off) return;
        entries.push([o.id, price]);
      }
      if (!off) setOccurrencePrice(Object.fromEntries(entries));
    })();
    return () => { off = true; };
  }, [occurrences, assignments, vehicles, operatorsById, taxRate, feesRate]);

  // calendar
  const eventsByDay = useMemo(() => {
    const m = new Map<string, Occurrence[]>();
    occurrences.forEach(o => (m.get(o.dateISO) ?? m.set(o.dateISO, []).get(o.dateISO)!).push(o));
    return m;
  }, [occurrences]);

  const PickupTile: React.FC<{ p: Pickup }> = ({ p }) => (
    <button
      className={`break-inside-avoid block w-full text-left rounded-2xl border overflow-hidden shadow transition mb-4 ${selectedPickupId === p.id ? "border-blue-500 ring-1 ring-blue-300" : "border-neutral-200 bg-white hover:shadow-md"}`}
      onClick={() => setSelectedPickupId(p.id)}
      title={`Choose pick-up ${p.name}`}
    >
      <div className="relative w-full aspect-[16/9] bg-neutral-100">
        {thumbs[`pu_${p.id}`] ? (
          <img src={thumbs[`pu_${p.id}`] as string} alt={p.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>}
      </div>
      <div className="p-3">
        <div className="font-medium">{p.name}</div>
        {p.description && <div className="mt-1 text-sm text-neutral-700">{p.description}</div>}
      </div>
    </button>
  );

  const CalendarMonth: React.FC<{ onPickDay?: (iso: string) => void; }> = ({ onPickDay }) => {
    const monthStart = startOfMonth(calCursor);
    const monthEnd = endOfMonth(calCursor);

    const daysInMonth = monthEnd.getDate();
    const firstWeekday = monthStart.getDay();

    const cells: { iso?: string; label?: number }[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push({});
    for (let d = 1; d <= daysInMonth; d++) {
      const dd = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const iso = dd.toISOString().slice(0,10);
      cells.push({ iso, label: d });
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button className="rounded-full px-3 py-1 border text-sm" onClick={() => setCalCursor(startOfMonth(addMonths(calCursor, -1)))}>← Prev</button>
          <div className="font-medium">{monthStart.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
          <button className="rounded-full px-3 py-1 border text-sm" onClick={() => setCalCursor(startOfMonth(addMonths(calCursor, 1)))}>Next →</button>
        </div>

        <div className="grid grid-cols-7 gap-2 text-xs text-neutral-600">
          {DAY_SHORT.map((d) => (<div key={d} className="text-center">{d}</div>))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {cells.map((c, idx) => {
            const dayEvents = (c.iso && eventsByDay.get(c.iso)) || [];
            const sorted = dayEvents.slice().sort((a,b) => {
              const pa = occurrencePrice[a.id] ?? Number.POSITIVE_INFINITY;
              const pb = occurrencePrice[b.id] ?? Number.POSITIVE_INFINITY;
              if (pa !== pb) return pa - pb;
              const at = a.route.pickup_time || ""; const bt = b.route.pickup_time || "";
              return at.localeCompare(bt);
            });
            const hasAny = sorted.length > 0;

            return (
              <div key={idx} className={`rounded-xl border p-2 min-h-[110px] ${hasAny ? "bg-white" : ""}`}>
                <div className="text-xs text-neutral-600">{c.label ?? ""}</div>
                <div className="mt-1 space-y-1">
                  {sorted.length === 0 ? (
                    <div className="text-[11px] text-neutral-400">—</div>
                  ) : (
                    sorted.slice(0, 4).map((it) => {
                      const price = occurrencePrice[it.id];
                      const name = it.route.route_name || "Journey";
                      const time = it.route.pickup_time ? hhmmLocalToDisplay(it.route.pickup_time) : null;
                      return (
                        <button
                          key={it.id}
                          className="w-full text-left rounded-lg border px-2 py-1 hover:bg-neutral-50"
                          onClick={() => {
                            const qp = new URLSearchParams({
                              routeId: it.route.id,
                              date: it.dateISO,
                              pickupId: selectedPickupId || "",
                              destinationId: destinationId,
                              country_id: countryId,
                            });
                            if (journeyTypeIdParam) qp.set("journey_type_id", journeyTypeIdParam);
                            router.push(`/book/details?${qp.toString()}`);
                            onPickDay?.(it.dateISO);
                          }}
                          title={`Select ${new Date((it.dateISO) + "T12:00:00").toLocaleDateString()} • ${name}`}
                        >
                          <div className="text-[11px] font-medium leading-tight truncate">{name}</div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-neutral-600">{time ?? ""}</span>
                            <span className="shrink-0 rounded-md bg-neutral-900 text-white px-1.5 py-0.5 text-[11px]">
                              {typeof price === "number" ? `$${price.toFixed(2)} / seat` : "—"}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <WizardHeader step={4} />

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {/* ---- Journey Type Filter chips ---- */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={`rounded-full border px-4 py-2 ${!journeyTypeIdParam ? "bg-black text-white border-black" : "bg-white"}`}
            onClick={() => setQueryParam("journey_type_id")}
          >
            All Types
          </button>

          {typeOptions.map((t) => (
            <button
              key={t.id}
              className={`rounded-full border px-4 py-2 ${journeyTypeIdParam === t.id ? "bg-black text-white border-black" : "bg-white"}`}
              onClick={() => setQueryParam("journey_type_id", t.id)}
              title={t.name}
            >
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {/* Pick-up selection (auto-selects if only one) */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pick-up</h2>
          {selectedPickupId && (
            <button className="text-sm text-neutral-600 underline" onClick={() => setSelectedPickupId(null)}>Change pick-up</button>
          )}
        </div>

        {!selectedPickupId ? (
          availablePickups.length === 0 ? (
            <div className="p-2 text-sm text-neutral-600">No pick-up points available for this destination.</div>
          ) : (
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
              {availablePickups.map((p) => <PickupTile key={p.id} p={p} />)}
            </div>
          )
        ) : (
          <div className="text-sm text-neutral-700">Selected pick-up: <strong>{availablePickups.find(p => p.id === selectedPickupId)?.name ?? ""}</strong></div>
        )}
      </section>

      {/* Calendar (only once a pick-up is set) */}
      {selectedPickupId && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow space-y-3">
          <h2 className="text-lg font-semibold">Select a date</h2>
          <CalendarMonth />
        </section>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<section className="rounded-2xl border p-4 bg-white m-4">Loading…</section>}>
      <Inner />
    </Suspense>
  );
}
