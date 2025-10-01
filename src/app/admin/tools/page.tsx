// src/app/admin/tools/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type JourneyRow = {
  id: string;
  route_id: string;
  departure_ts: string;
  pickup_name: string | null;
  destination_name: string | null;
};

type AssignedVehicleRow = {
  vehicle_id: string;
  vehicle_name: string | null;
  operator_name: string | null;
  operator_commission?: number | null;
  seats_capacity: number | null;
  /** TOTAL minimum revenue for the boat, in POUNDS (whole integers) */
  base?: number | null;
  minseats?: number | null;
  maxseatdiscount?: number | null; // 0..1 – seats >= min and < cap
  /** % (0..1) operator accepts if min can't be met at T-24 */
  min_val_threshold?: number | null;
  preferred: boolean;
  is_active: boolean;
};

type QuoteBreakdown = {
  unit: number | null;  // cents per seat (incl tax & fees)
  base: number | null;  // cents per seat (base only)
  tax: number | null;   // cents per seat
  fees: number | null;  // cents per seat
  total: number | null; // cents for whole order
  currency?: string;
  vehicle_id?: string;
  debug?: any;
};

function moneyFromMinor(x?: number | null, currency: string = "GBP") {
  if (x == null) return "—";
  const v = x / 100;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(v);
}
const poundsToPence = (x?: number | null) => (x == null ? null : Math.round(Number(x) * 100));
const roundUpToWholeCurrency = (minor: number) => Math.ceil(minor / 100) * 100;

/* ------------------------ price helpers ------------------------ */

function basePerSeatNoDiscountCents(v: AssignedVehicleRow): number | null {
  if (v.base == null) return null;
  const minSeats = v.minseats ?? 0;
  if (minSeats <= 0) return null;
  const totalMinRevenuePence = Math.round(Number(v.base) * 100);
  return Math.round(totalMinRevenuePence / minSeats);
}

/** Base for the *next seat* (pence), considering:
 *  - If `forceDiscount=true` (post T-72) => discount applies regardless of seat count.
 *  - Else seats < min => no discount; seats >= min => maxseatdiscount applies.
 */
function baseCentsForNextSeat(
  v: AssignedVehicleRow,
  currentCount: number,
  forceDiscount: boolean
): number | null {
  const base0 = basePerSeatNoDiscountCents(v);
  if (base0 == null) return null;

  const min = v.minseats ?? 0;
  const cap = v.seats_capacity ?? Number.POSITIVE_INFINITY;
  const inDiscountBand = currentCount >= min && currentCount < cap;

  const disc =
    forceDiscount || inDiscountBand
      ? Math.max(0, Math.min(1, v.maxseatdiscount ?? 0))
      : 0;

  return Math.round(base0 * (1 - disc));
}

function unitCentsForNextSeat(
  v: AssignedVehicleRow,
  currentCount: number,
  taxRate: number,
  feeRate: number,
  forceDiscount: boolean
) {
  const base = baseCentsForNextSeat(v, currentCount, forceDiscount);
  if (base == null) return null;
  const tax = Math.round(base * taxRate);
  const basePlusTax = base + tax;
  const fees = Math.round(basePlusTax * feeRate);
  return roundUpToWholeCurrency(basePlusTax + fees);
}

function boatAllowedTargetPence(v: AssignedVehicleRow) {
  const minRev = poundsToPence(v.base);
  if (minRev == null) return null;
  const t = v.min_val_threshold ?? 1;
  return Math.round(minRev * Math.max(0, Math.min(1, t)));
}

/* ------------------------ sort & current pricing boat ------------------------ */

function sortByNextSeatPrice(
  boats: AssignedVehicleRow[],
  counts: Record<string, number>,
  taxRate: number,
  feeRate: number,
  forceDiscountIds: Set<string>
) {
  return [...boats].sort((a, b) => {
    const ua =
      unitCentsForNextSeat(a, counts[a.vehicle_id] ?? 0, taxRate, feeRate, forceDiscountIds.has(a.vehicle_id)) ??
      Number.POSITIVE_INFINITY;
    const ub =
      unitCentsForNextSeat(b, counts[b.vehicle_id] ?? 0, taxRate, feeRate, forceDiscountIds.has(b.vehicle_id)) ??
      Number.POSITIVE_INFINITY;
    if (ua !== ub) return ua - ub;
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
    return (a.vehicle_name || "").localeCompare(b.vehicle_name || "");
  });
}

function currentPricingBoat(
  assigned: AssignedVehicleRow[],
  allocationsLike: Record<string, number>,
  taxRate: number,
  feeRate: number,
  forceDiscountIds: Set<string>
): { boat: AssignedVehicleRow | null; unit: number | null } {
  const active = assigned.filter(a => a.is_active);
  const withCapacity = active.filter(v => {
    const have = allocationsLike[v.vehicle_id] ?? 0;
    const cap = v.seats_capacity ?? 0;
    return have < cap;
  });
  const belowMin = withCapacity.filter(v => (allocationsLike[v.vehicle_id] ?? 0) < (v.minseats ?? 0));

  const pickCheapest = (pool: AssignedVehicleRow[]) => {
    const sorted = sortByNextSeatPrice(pool, allocationsLike, taxRate, feeRate, forceDiscountIds);
    if (!sorted.length) return { boat: null, unit: null };
    const boat = sorted[0];
    const unit = unitCentsForNextSeat(
      boat,
      allocationsLike[boat.vehicle_id] ?? 0,
      taxRate,
      feeRate,
      forceDiscountIds.has(boat.vehicle_id)
    );
    return { boat, unit: unit ?? null };
  };

  if (belowMin.length) return pickCheapest(belowMin);
  return pickCheapest(withCapacity);
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function AllocationLabPage() {
  const [journeys, setJourneys] = React.useState<JourneyRow[]>([]);
  const [journeyId, setJourneyId] = React.useState("");
  const [selectedJourney, setSelectedJourney] = React.useState<JourneyRow | null>(null);
  const [assigned, setAssigned] = React.useState<AssignedVehicleRow[]>([]);
  const [allocations, setAllocations] = React.useState<Record<string, number>>({});
  const [forecastQty, setForecastQty] = React.useState(1);
  const [quote, setQuote] = React.useState<QuoteBreakdown | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Guarded add (prevents overbooking, especially post T-72)
  const addTestOrderSafely = (qty: number) => {
    const q = Math.max(1, Math.floor(qty || 0));
    if (!q) return;
    // Basic total capacity guard
    if (q > availability.totalLeft) {
      setError(`Only ${availability.totalLeft} seat(s) remain in total.`);
      return;
    }
    // Post T-72: must also fit on a single in-play boat (no new boats opened)
    if (t72 && q > availability.maxGap) {
      setError(`Post T-72: largest party that fits on a single in‑play boat is ${availability.maxGap}.`);
      return;
    }
    setError(null);
    addTestOrder(q);
  };

  // Local testing (each entry is a paid group)
  const [testOrders, setTestOrders] = React.useState<number[]>([]);
  const addTestOrder = (n: number) => setTestOrders(prev => [...prev, Math.max(1, Math.floor(n))]);
  const clearTestOrders = () => { setTestOrders([]); setFinalSnap(null); setT72(null); };

  // T-72h state
  type T72State = {
    at: string;
    forcedDiscountIds: Set<string>;
    repackedCounts: Record<string, number>;
    placedOn: Array<{ group: number; vehicle_name: string | null; vehicle_id?: string | null }>;
    strandedGroups: number[];
    inPlayIds: Set<string>;
    notes: string[];
  } | null;
  const [t72, setT72] = React.useState<T72State>(null);

  // T-24 snapshot
  const [finalSnap, setFinalSnap] = React.useState<ReturnType<typeof buildFinalSnapshot> | null>(null);
  const finalRef = React.useRef<HTMLDivElement | null>(null);

  /* ---------- Load journeys ---------- */
  React.useEffect(() => {
    (async () => {
      setError(null);
      const jRes = await supabase
        .from("journeys")
        .select("id, route_id, departure_ts")
        .eq("is_active", true)
        .gte("departure_ts", new Date().toISOString())
        .limit(200);

      if (jRes.error) { setError(jRes.error.message); return; }
      const bare = (jRes.data as any[]) || [];
      if (!bare.length) { setJourneys([]); return; }

      const routeIds = Array.from(new Set(bare.map(r => r.route_id)));
      const [routesRes, puRes, deRes] = await Promise.all([
        supabase.from("routes").select("id, pickup_id, destination_id").in("id", routeIds),
        supabase.from("pickup_points").select("id, name"),
        supabase.from("destinations").select("id, name"),
      ]);

      const routeMap = new Map<string, { pickup_id: string | null; destination_id: string | null }>();
      if (!routesRes.error && routesRes.data) {
        for (const r of routesRes.data as any[]) {
          routeMap.set(r.id, { pickup_id: r.pickup_id ?? null, destination_id: r.destination_id ?? null });
        }
      }
      const puMap = new Map<string, string>();
      if (!puRes.error && puRes.data) for (const p of puRes.data as any[]) puMap.set(p.id, p.name);
      const deMap = new Map<string, string>();
      if (!deRes.error && deRes.data) for (const d of deRes.data as any[]) deMap.set(d.id, d.name);

      const rows: JourneyRow[] = bare
        .map(r => {
          const route = routeMap.get(r.route_id);
          return {
            id: r.id,
            route_id: r.route_id,
            departure_ts: r.departure_ts,
            pickup_name: route?.pickup_id ? puMap.get(route.pickup_id) ?? null : null,
            destination_name: route?.destination_id ? deMap.get(route.destination_id) ?? null : null,
          };
        })
        .sort((a, b) => a.departure_ts.localeCompare(b.departure_ts));

      setJourneys(rows);
    })();
  }, []);

  React.useEffect(() => {
    setSelectedJourney(journeys.find(x => x.id === journeyId) || null);
    setTestOrders([]); setFinalSnap(null); setT72(null);
  }, [journeyId, journeys]);

  /* ---------- Load vehicles/assignments ---------- */
  React.useEffect(() => {
    if (!selectedJourney) return;
    (async () => {
      setError(null);

      const ra = await supabase
        .from("route_vehicle_assignments")
        .select("vehicle_id, preferred, is_active")
        .eq("route_id", selectedJourney.route_id)
        .limit(500);

      if (ra.error) { setError(ra.error.message); return; }

      const asn = (ra.data as any[]) || [];
      const vIds = Array.from(new Set(asn.map(r => r.vehicle_id).filter(Boolean)));

      let vehMap = new Map<string, any>();
      if (vIds.length) {
        const vq = await supabase
          .from("vehicles")
          .select("id,name,active,operator_id,minseats,maxseats,minvalue,maxseatdiscount,min_val_threshold,preferred")
          .in("id", vIds);
        if (!vq.error && vq.data) vehMap = new Map((vq.data as any[]).map(v => [v.id, v]));
      }

      const opIds = Array.from(new Set(Array.from(vehMap.values()).map((v: any) => v.operator_id).filter(Boolean)));
      const opMap = new Map<string, { name: string; commission: number | null }>();
      if (opIds.length) {
        const oq = await supabase.from("operators").select("id,name,commisison").in("id", opIds as string[]);
        if (!oq.error && oq.data) (oq.data as any[]).forEach(o => opMap.set(o.id, { name: o.name, commission: o.commisison ?? null }));
      }

      const rows: AssignedVehicleRow[] = asn
        .map(r => {
          const v = vehMap.get(r.vehicle_id) || {};
          const cap = v?.maxseats == null ? null : Number(v.maxseats);
          return {
            vehicle_id: r.vehicle_id,
            vehicle_name: v.name ?? null,
            operator_name: v.operator_id ? (opMap.get(v.operator_id)?.name ?? null) : null,
            seats_capacity: Number.isFinite(cap) ? cap : null,
            base: v.minvalue ?? null,
            minseats: v.minseats != null ? Number(v.minseats) : null,
            maxseatdiscount: v.maxseatdiscount ?? null,
            min_val_threshold: v.min_val_threshold ?? null,
            preferred: !!v.preferred,
            operator_commission: v.operator_id ? (opMap.get(v.operator_id)?.commission ?? null) : null,
            is_active: (r.is_active ?? true) && (v.active ?? true),
          };
        })
        .filter(x => x.is_active !== false);

      setAssigned(rows);
    })();
  }, [selectedJourney?.route_id, selectedJourney]);

  /* ---------- Poll allocations ---------- */
  React.useEffect(() => {
    if (!journeyId) return;
    const refresh = async (jid: string) => {
      setError(null);
      const b = await supabase
        .from("bookings")
        .select("vehicle_id, seats")
        .eq("journey_id", jid)
        .limit(5000);

      if (!b.error && b.data) {
        const tallies: Record<string, number> = {};
        for (const r of b.data as any[]) {
          const vid = r.vehicle_id as string | null;
          const s = Number(r.seats ?? 0);
          if (!vid) continue;
          tallies[vid] = (tallies[vid] || 0) + (Number.isFinite(s) ? s : 0);
        }
        setAllocations(tallies);
        return;
      }

      const v = await supabase
        .from("booking_seat_counts")
        .select("journey_id, seats")
        .eq("journey_id", jid);

      if (!v.error && v.data) {
        const total = (v.data as any[]).reduce((acc, r) => acc + Number(r.seats ?? 0), 0);
        setAllocations({ __total__: total });
        return;
      }

      setAllocations({});
      setError(b.error?.message || v.error?.message || "Unable to load allocations");
    };

    refresh(journeyId);
    const t = setInterval(() => refresh(journeyId), 5000);
    return () => clearInterval(t);
  }, [journeyId]);

  /* ---------- Quote -> tax/fee rates ---------- */
  const taxRate = React.useMemo(() => {
    if (!quote?.base || quote.base <= 0) return 0;
    return (quote.tax ?? 0) / quote.base;
  }, [quote?.base, quote?.tax]);

  const feeRate = React.useMemo(() => {
    const basePlusTax = (quote?.base ?? 0) + (quote?.tax ?? 0);
    if (basePlusTax <= 0) return 0;
    return (quote?.fees ?? 0) / basePlusTax;
  }, [quote?.base, quote?.tax, quote?.fees]);

  /* ---------- Commission config ---------- */
  const [commissionRate, setCommissionRate] = React.useState<number>(0.2); // 20% default


  /* ---------- Base counts used for calcs (DB vs T-72 repack) ---------- */
  const baseCountsForCalc = React.useMemo<Record<string, number>>(() => {
    return t72 ? { ...t72.repackedCounts } : { ...allocations };
  }, [t72, allocations]);

  /* ---------- Sim (laddered min-fill) ---------- */
  type Placement = {
    group: number;
    vehicle_id: string | null;
    vehicle_name: string | null;
    reason: "placed-on-open-cheapest" | "opened-new-met-target" | "opened-new-cheapest" | "no-capacity";
    shortfallBefore?: number;
    shortfallAfter?: number;
  };

  const sim = React.useMemo(() => {
    // After T-72, the repack already consumed the staged groups,
    // so do not apply testOrders again (prevents “doubling”).
    const orderBatches = testOrders;

    const activeBoats = (t72
      ? assigned.filter(a => a.is_active && t72.inPlayIds.has(a.vehicle_id))
      : assigned.filter(a => a.is_active)
    );

    const targets = new Map<string, number | null>();
    for (const v of activeBoats) targets.set(v.vehicle_id, boatAllowedTargetPence(v));

    const current: Record<string, number> = { ...baseCountsForCalc };
    const perVehicle: Record<string, { add: number; pricePerSeat: number | null }> = {};
    const openIds = new Set<string>();
    const placements: Placement[] = [];

    for (const v of activeBoats) if ((current[v.vehicle_id] ?? 0) > 0) openIds.add(v.vehicle_id);

    const canFit = (v: AssignedVehicleRow, g: number) => {
      const cap = v.seats_capacity ?? Number.MAX_SAFE_INTEGER;
      return (current[v.vehicle_id] ?? 0) + g <= cap;
    };
    const byCheapestNow = () =>
      sortByNextSeatPrice(activeBoats, current, taxRate, feeRate, t72?.forcedDiscountIds ?? new Set());

    const projRevenueAfterAdding = (v: AssignedVehicleRow, g: number) => {
      const unit = unitCentsForNextSeat(
        v,
        current[v.vehicle_id] ?? 0,
        taxRate,
        feeRate,
        (t72?.forcedDiscountIds ?? new Set()).has(v.vehicle_id)
      ) ?? 0;
      const after = (current[v.vehicle_id] ?? 0) + g;
      return unit * after;
    };

    const shortfall = (v: AssignedVehicleRow, g: number) => {
      const tgt = targets.get(v.vehicle_id);
      if (tgt == null) return 0;
      return Math.max(0, tgt - projRevenueAfterAdding(v, g));
    };

    for (const g of orderBatches) {
      const sorted = byCheapestNow();

      // 1) Prefer OPEN boats below MIN that can fit
      const openBelowMinThatFit = sorted.filter(v => {
        if (!openIds.has(v.vehicle_id)) return false;
        const have = (current[v.vehicle_id] ?? 0);
        return have < (v.minseats ?? 0) && canFit(v, g);
      });
      if (openBelowMinThatFit.length) {
        const v = openBelowMinThatFit[0];
        const sfBefore = shortfall(v, 0);
        const sfAfter = shortfall(v, g);
        placements.push({ group: g, vehicle_id: v.vehicle_id, vehicle_name: v.vehicle_name, reason: "placed-on-open-cheapest", shortfallBefore: sfBefore, shortfallAfter: sfAfter });
        current[v.vehicle_id] = (current[v.vehicle_id] ?? 0) + g;
        openIds.add(v.vehicle_id);
        const unit = unitCentsForNextSeat(v, current[v.vehicle_id], taxRate, feeRate, (t72?.forcedDiscountIds ?? new Set()).has(v.vehicle_id));
        perVehicle[v.vehicle_id] = { add: (perVehicle[v.vehicle_id]?.add ?? 0) + g, pricePerSeat: unit ?? null };
        continue;
      }

      // 2) Try opening a NEW boat (prefer hitting allowed target)
      const unopenedThatFit = sorted.filter(v => !openIds.has(v.vehicle_id) && canFit(v, g));
      if (!t72 && unopenedThatFit.length) { // Post-T72 we never open new boats
        const hitsTarget = unopenedThatFit.find(v => {
          const tgt = targets.get(v.vehicle_id);
          if (tgt == null) return false;
          return projRevenueAfterAdding(v, g) >= tgt;
        });
        const chosen = hitsTarget ?? unopenedThatFit[0];
        const sfBefore = shortfall(chosen, 0);
        const sfAfter = shortfall(chosen, g);
        placements.push({ group: g, vehicle_id: chosen.vehicle_id, vehicle_name: chosen.vehicle_name, reason: hitsTarget ? "opened-new-met-target" : "opened-new-cheapest", shortfallBefore: sfBefore, shortfallAfter: sfAfter });
        current[chosen.vehicle_id] = (current[chosen.vehicle_id] ?? 0) + g;
        openIds.add(chosen.vehicle_id);
        const unit = unitCentsForNextSeat(chosen, current[chosen.vehicle_id], taxRate, feeRate, (t72?.forcedDiscountIds ?? new Set()).has(chosen.vehicle_id));
        perVehicle[chosen.vehicle_id] = { add: (perVehicle[chosen.vehicle_id]?.add ?? 0) + g, pricePerSeat: unit ?? null };
        continue;
      }

      // 3) Otherwise place on cheapest OPEN boat that can fit
      const openThatFit = sorted.filter(v => openIds.has(v.vehicle_id) && canFit(v, g));
      if (openThatFit.length) {
        const v = openThatFit[0];
        const sfBefore = shortfall(v, 0);
        const sfAfter = shortfall(v, g);
        placements.push({ group: g, vehicle_id: v.vehicle_id, vehicle_name: v.vehicle_name, reason: "placed-on-open-cheapest", shortfallBefore: sfBefore, shortfallAfter: sfAfter });
        current[v.vehicle_id] = (current[v.vehicle_id] ?? 0) + g;
        openIds.add(v.vehicle_id);
        const unit = unitCentsForNextSeat(v, current[v.vehicle_id], taxRate, feeRate, (t72?.forcedDiscountIds ?? new Set()).has(v.vehicle_id));
        perVehicle[v.vehicle_id] = { add: (perVehicle[v.vehicle_id]?.add ?? 0) + g, pricePerSeat: unit ?? null };
        continue;
      }

      placements.push({ group: g, vehicle_id: null, vehicle_name: null, reason: "no-capacity" });
    }

    return {
      batches: orderBatches,
      total: orderBatches.reduce((a, b) => a + b, 0),
      perVehicle,
      placements,
      _currentAfter: current,
      unplacedBatches: placements.filter(p => p.reason === "no-capacity").map(p => p.group),
    };
  }, [testOrders, assigned, allocations, taxRate, feeRate, t72?.forcedDiscountIds, t72?.inPlayIds, baseCountsForCalc, t72]);

  // Projected counts for display & pricing (DB/repack + sim.add)
  const projectedWithSim = React.useMemo(() => {
    const m: Record<string, number> = { ...baseCountsForCalc };
    for (const [vid, info] of Object.entries(sim.perVehicle ?? {})) {
      const add = (info as any)?.add ?? 0;
      if (add > 0) m[vid] = (m[vid] ?? 0) + add;
    }
    return m;
  }, [baseCountsForCalc, sim.perVehicle]);

  /* ---------- Availability snapshot (ALWAYS ON) ---------- */
  function computeAvailabilitySnapshot() {
    const pool = t72
      ? assigned.filter(a => a.is_active && t72.inPlayIds.has(a.vehicle_id))
      : assigned.filter(a => a.is_active);

    let totalLeft = 0;
    let maxGap = 0;
    const gaps: Array<{ vehicle_id: string; name: string | null; gap: number }> = [];

    for (const v of pool) {
      const cap = v.seats_capacity ?? 0;
      const have = projectedWithSim[v.vehicle_id] ?? 0;
      const gap = Math.max(0, cap - have);
      totalLeft += gap;
      maxGap = Math.max(maxGap, gap);
      gaps.push({ vehicle_id: v.vehicle_id, name: v.vehicle_name, gap });
    }

    gaps.sort((a, b) => b.gap - a.gap);
    return { totalLeft, maxGap, gaps, pool };
  }
  const availability = React.useMemo(computeAvailabilitySnapshot, [assigned, projectedWithSim, t72?.inPlayIds]);

  /* ---------- Low seat global warnings ---------- */
  const lowSeatWarnings = React.useMemo(() => {
    const crit: string[] = [];
    const low: string[] = [];
    for (const g of availability.gaps) {
      if (g.gap <= 3) crit.push(`${g.name ?? "Boat"}: ${g.gap}`);
      else if (g.gap <= 5) low.push(`${g.name ?? "Boat"}: ${g.gap}`);
    }
    return { crit, low };
  }, [availability.gaps]);

  /* ---------- Advertised price (respect T-72 in-play) ---------- */
  const pricingBoatMemo = React.useMemo(() => {
    const pool = t72
      ? assigned.filter(a => a.is_active && t72.inPlayIds.has(a.vehicle_id))
      : assigned;
    return currentPricingBoat(pool, projectedWithSim, taxRate, feeRate, t72?.forcedDiscountIds ?? new Set());
  }, [assigned, projectedWithSim, taxRate, feeRate, t72?.forcedDiscountIds, t72?.inPlayIds]);

  const pricingBoat = pricingBoatMemo.boat;
  const advertisedUnitCents = pricingBoatMemo.unit;

  /* ---------- Quote fetch (with guards) ---------- */
  async function fetchQuote() {
    if (!selectedJourney) return;

    if (availability.totalLeft <= 0) { setError("Sold out: no seats remaining."); return; }
    if (forecastQty > availability.maxGap) { setError(`Max party size that fits on a single boat is ${availability.maxGap}. Please reduce quantity.`); return; }
    if (forecastQty > availability.totalLeft) { setError(`Only ${availability.totalLeft} seat(s) remain in total.`); return; }

    const boatForQuote = pricingBoat ?? null;
    const params = new URLSearchParams({
      route_id: selectedJourney.route_id,
      date: selectedJourney.departure_ts.slice(0, 10),
      qty: String(forecastQty),
      diag: "1",
    });
    if (boatForQuote?.vehicle_id) params.set("vehicle_id", boatForQuote.vehicle_id);

    const res = await fetch(`/api/quote?${params.toString()}`);
    const j = await res.json();
    setQuote({
      unit: j?.unit_cents ?? null,
      base: j?.base_cents ?? null,
      tax: j?.tax_cents ?? null,
      fees: j?.fees_cents ?? null,
      total: j?.total_cents ?? null,
      currency: j?.currency ?? "GBP",
      vehicle_id: j?.vehicle_id ?? boatForQuote?.vehicle_id ?? undefined,
      debug: j?.debug ?? null,
    });
    setError(null);
  }
  React.useEffect(() => { if (selectedJourney) fetchQuote(); }, [selectedJourney?.id, forecastQty, pricingBoat?.vehicle_id]);

  /* ------------------------ T-72h decision (seed from DB) ------------------------ */
  function decideTMinus72() {
    const boats = assigned.filter(a => a.is_active);
    const orderByPrice = sortByNextSeatPrice(boats, allocations, taxRate, feeRate, new Set());
    const counts: Record<string, number> = { ...allocations };

    const groups = [...testOrders].sort((a, b) => b - a);
    const placedOn: Array<{ group: number; vehicle_name: string | null; vehicle_id?: string | null }> = [];
    const stranded: number[] = [];

    const tryOpenToMin = (v: AssignedVehicleRow): boolean => {
      const cap = v.seats_capacity ?? Number.MAX_SAFE_INTEGER;
      const min = v.minseats ?? 0;
      let tempHave = counts[v.vehicle_id] ?? 0;
      const taken: number[] = [];
      for (let i = 0; i < groups.length && tempHave < min; ) {
        const g = groups[i];
        if (tempHave + g <= cap) {
          tempHave += g;
          taken.push(g);
          groups.splice(i, 1);
        } else {
          i++;
        }
      }
      if (tempHave >= min && tempHave > (counts[v.vehicle_id] ?? 0)) {
        counts[v.vehicle_id] = tempHave;
        for (const g of taken) placedOn.push({ group: g, vehicle_name: v.vehicle_name, vehicle_id: v.vehicle_id });
        return true;
      }
      for (const g of taken) groups.push(g);
      groups.sort((a, b) => b - a);
      return false;
    };

    for (const v of orderByPrice) {
      if (!groups.length) break;
      tryOpenToMin(v);
    }

    for (let i = 0; i < groups.length; ) {
      const g = groups[i];
      let placed = false;
      for (const v of orderByPrice) {
        const cap = v.seats_capacity ?? Number.MAX_SAFE_INTEGER;
        const have = counts[v.vehicle_id] ?? 0;
        if (have > 0 && have + g <= cap) {
          counts[v.vehicle_id] = have + g;
          placedOn.push({ group: g, vehicle_name: v.vehicle_name, vehicle_id: v.vehicle_id });
          groups.splice(i, 1);
          placed = true;
          break;
        }
      }
      if (!placed) i++;
    }

    for (const v of orderByPrice) {
      if (!groups.length) break;
      const have = counts[v.vehicle_id] ?? 0;
      if (have > 0) continue;
      if (tryOpenToMin(v)) {
        const cap = v.seats_capacity ?? Number.MAX_SAFE_INTEGER;
        let cur = counts[v.vehicle_id] ?? 0;
        for (let i = 0; i < groups.length; ) {
          const g = groups[i];
          if (cur + g <= cap) {
            cur += g;
            counts[v.vehicle_id] = cur;
            placedOn.push({ group: g, vehicle_name: v.vehicle_name, vehicle_id: v.vehicle_id });
            groups.splice(i, 1);
          } else {
            i++;
          }
        }
      }
    }

    stranded.push(...groups);

    const forced = new Set<string>();
    let inPlayIds = new Set<string>(
      Object.keys(counts).filter(vid => (counts[vid] ?? 0) > 0)
    );
    for (const v of boats) {
      const result = counts[v.vehicle_id] ?? 0;
      if (result >= (v.minseats ?? 0) && result > 0) forced.add(v.vehicle_id);
    }
    if (inPlayIds.size === 0) {
      const cheapest = sortByNextSeatPrice(boats, counts, taxRate, feeRate, new Set())
        .find(v => (v.seats_capacity ?? 0) > 0);
      if (cheapest) inPlayIds = new Set([cheapest.vehicle_id]);
    }

    const notes: string[] = [];
    notes.push("T-72h policy applied:");
    notes.push("• Seeded from current DB allocations to avoid clearing the table.");
    notes.push("• Repacked groups to minimise boats while meeting each boat’s minimum seats (lazy-open).");
    notes.push("• Boats that reached minimum seats now advertise discounted prices (maxseatdiscount).");
    notes.push("• Post T-72, only in-play boats remain visible for pricing/availability.");

    setT72({
      at: new Date().toISOString(),
      forcedDiscountIds: forced,
      repackedCounts: counts,
      placedOn,
      strandedGroups: stranded,
      inPlayIds,
      notes,
    });

    setTestOrders([]);
    setFinalSnap(null);
  }

  /* ------------------------ helpers for UI chips ------------------------ */
  const placedGroupsByBoat = React.useMemo(() => {
    const map: Record<string, number[]> = {};
    for (const p of sim.placements) {
      if (!p.vehicle_id) continue;
      if (!map[p.vehicle_id]) map[p.vehicle_id] = [];
      map[p.vehicle_id].push(p.group);
    }
    // also include T-72 repack placed groups if we captured them
    if (t72?.placedOn) {
      for (const p of t72.placedOn) {
        if (!p.vehicle_id) continue;
        if (!map[p.vehicle_id]) map[p.vehicle_id] = [];
        map[p.vehicle_id].push(p.group);
      }
    }
    return map;
  }, [sim.placements, t72?.placedOn]);

  /* ------------------------ T-24h final snapshot ------------------------ */
  type FinalRow = {
    vehicle_id: string;
    vehicle_name: string | null;
    operator_name: string | null;
  operator_commission?: number | null;
    booked_db: number;
    add: number;
    result: number;
    min: number;
    cap: number | null;
    unit: number | null;
    revenue: number | null;
    minRevenue: number | null;
    allowedTarget: number | null;
    belowAllowed: boolean;
    delta: number | null;
  };

  function buildFinalSnapshot(): {
    at: string;
    rows: FinalRow[];
    totals: { pax: number; revenue: number; minRevenue: number; delta: number };
    unplaced: number[];
    summary: string[];
  } {
    const consider = t72
      ? assigned.filter(v => t72.inPlayIds.has(v.vehicle_id))
      : assigned;

    const rows: FinalRow[] = consider.map(v => {
      const bookedDb = allocations[v.vehicle_id] ?? 0;
      const add = sim.perVehicle[v.vehicle_id]?.add ?? 0;
      const base = baseCountsForCalc[v.vehicle_id] ?? 0;
      const result = base + add;

      const min = v.minseats ?? 0;
      const cap = v.seats_capacity ?? null;
      const unit = unitCentsForNextSeat(v, result, taxRate, feeRate, t72?.forcedDiscountIds?.has(v.vehicle_id) ?? false);
      const revenue = unit == null ? null : unit * result;
      const minRevenue = unit == null ? null : unit * min;
      const allowedTarget = boatAllowedTargetPence(v);
      const belowAllowed = allowedTarget != null && revenue != null ? revenue < allowedTarget : false;
      const delta = unit == null ? null : (revenue! - (minRevenue ?? 0));
      return { vehicle_id: v.vehicle_id, vehicle_name: v.vehicle_name, operator_name: v.operator_name, booked_db: bookedDb, add, result, min, cap, unit, revenue, minRevenue, allowedTarget, belowAllowed, delta };
    });

    const pax = rows.reduce((a, r) => a + r.result, 0);
    const revenue = rows.reduce((a, r) => a + (r.revenue ?? 0), 0);
    const minRevenue = rows.reduce((a, r) => a + (r.minRevenue ?? 0), 0);
    const delta = revenue - minRevenue;

    const summary: string[] = [];
    summary.push("Finalisation policy (T-24h): keep each paid group together; minimise boats while meeting financial targets; pre-T72 may open a boat if it meets allowed target; post-T72 never open new boats; use thresholds if needed; never split groups.");
    for (const p of sim.placements) {
      if (!p.vehicle_id) { summary.push(`Group of ${p.group}: could not be placed (insufficient capacity).`); continue; }
      const reasonText =
        p.reason === "placed-on-open-cheapest" ? "placed on already-open boat with the lowest current price"
        : p.reason === "opened-new-met-target" ? "opened new boat that meets its allowed target with this group"
        : "opened new boat with the lowest current price";
      summary.push(`Group of ${p.group}: ${reasonText} – ${p.vehicle_name ?? "boat"}.`);
    }
    return {
      at: new Date().toISOString(),
      rows,
      totals: { pax, revenue, minRevenue, delta },
      unplaced: sim.unplacedBatches ?? [],
      summary,
    };
  }

  async function confirmTMinus24() {
    if (!selectedJourney) return;

    if (availability.totalLeft <= 0) { setError("Sold out: no seats remaining."); return; }
    if (forecastQty > availability.maxGap) { setError(`Max party size that fits on a single boat is ${availability.maxGap}.`); return; }
    if (forecastQty > availability.totalLeft) { setError(`Only ${availability.totalLeft} seat(s) remain in total.`); return; }

    const snap = buildFinalSnapshot();
    setFinalSnap(snap);
    setTimeout(() => finalRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    try {
      await fetch("/api/allocations/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: selectedJourney.id,
          when: snap.at,
          simulated_orders: testOrders,
          simulated_allocation: sim,
          availability_before_confirm: {
            totalLeft: availability.totalLeft,
            largestParty: availability.maxGap,
            pricingBoatId: pricingBoat?.vehicle_id ?? null,
            advertisedUnitCents,
          },
        }),
      });
    } catch {}
  }

  /* ------------------------ UI ------------------------ */

  const Workbench = (
    <div className="rounded border p-3 bg-white shadow-sm sticky top-2 z-10 space-y-3">
      <div className="flex items-center flex-wrap gap-3">
        <select value={journeyId} onChange={(e) => setJourneyId(e.target.value)} className="border rounded px-2 py-1">
          <option value="">— Select a journey —</option>
          {journeys.map(j => (
            <option key={j.id} value={j.id}>
              {new Date(j.departure_ts).toLocaleString()} · {j.pickup_name} → {j.destination_name}
            </option>
          ))}
        </select>

        <label className="text-sm">
          Forecast qty:&nbsp;
          <input
            type="number"
            min={1}
            value={forecastQty}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value || 1));
              setForecastQty(v);
            }}
            className="w-20 border rounded px-2 py-1"
          />
        </label>

        <span className="text-sm ml-2">
          <strong>Current price:</strong>{" "}
          {moneyFromMinor(advertisedUnitCents, quote?.currency ?? "GBP")}
          {pricingBoat ? <> &nbsp;(<em>{pricingBoat.vehicle_name}</em>)</> : null}
        </span>

        <label className="text-sm ml-4">
          Commission %:&nbsp;
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(commissionRate * 100)}
            onChange={(e) => {
              const v = Math.max(0, Math.min(100, Number(e.target.value || 0)));
              setCommissionRate(v / 100);
            }}
            className="w-20 border rounded px-2 py-1"
          />
        </label>

        <div className="flex gap-2 ml-auto">
          <button className="border rounded px-3 py-1" onClick={decideTMinus72} disabled={!testOrders.length}>
            Decide T-72h
          </button>
          <button className="border rounded px-3 py-1" onClick={confirmTMinus24} disabled={!testOrders.length || availability.totalLeft <= 0 || forecastQty > availability.totalLeft || forecastQty > availability.maxGap}>
            Confirm T-24h
          </button>
          <button className="border rounded px-3 py-1" onClick={fetchQuote} disabled={availability.totalLeft <= 0 || forecastQty > availability.totalLeft || forecastQty > availability.maxGap}>
            Refresh Quote
          </button>
        </div>
      </div>

      {/* Batches row */}
      <div className="flex items-center flex-wrap gap-3">
        <input
          id="addQty"
          type="number"
          min={1}
          placeholder="qty"
          className="w-24 border rounded px-2 py-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = Number((e.target as HTMLInputElement).value || "0");
              if (v > 0) { addTestOrderSafely(v); (e.target as HTMLInputElement).value = ""; }
            }
          }}
        />
        <button
          className="border rounded px-3 py-1"
          onClick={() => {
            const el = document.getElementById("addQty") as HTMLInputElement | null;
            const v = Number(el?.value || "0");
            if (v > 0) { addTestOrderSafely(v); if (el) el.value = ""; }
          }}
        >
          Add order
        </button>
        <button className="border rounded px-3 py-1" onClick={clearTestOrders}>Clear</button>

        <span className="text-sm ml-2">
          <strong>Batches:</strong> [{testOrders.join(", ")}] (total {testOrders.reduce((a,b)=>a+b,0)})
        </span>
      </div>

      {/* Availability & warnings inline */}
      {selectedJourney && (
        <div className="rounded border p-2 bg-slate-50 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <div><strong>Total left:</strong> {availability.totalLeft}</div>
            <div><strong>Largest party (single boat):</strong> {availability.maxGap}</div>
            <div className="text-xs text-gray-600">
              {availability.gaps.slice(0, 4).map(g => `${g.name ?? "Boat"}: ${g.gap}`).join(" · ")}{availability.gaps.length > 4 ? " · …" : ""}
            </div>
          </div>

          {t72 && (lowSeatWarnings.crit.length > 0 || lowSeatWarnings.low.length > 0) && (
            <div className="mt-2 text-sm">
              {lowSeatWarnings.crit.length > 0 && (
                <div className="text-red-700 font-medium">Almost sold out: {lowSeatWarnings.crit.join(" · ")}</div>
              )}
              {lowSeatWarnings.low.length > 0 && (
                <div className="text-amber-700">Limited seats remaining: {lowSeatWarnings.low.join(" · ")}</div>
              )}
            </div>
          )}
        </div>
      )}

      {t72 && <div className="text-xs text-gray-600">Post T-72 in effect: <strong>no new boats</strong> can be opened and each group must fit on a single in‑play boat.</div>}

      {/* Live simulation summary table (small) */}
      <div>
        <table className="min-w-full text-xs border">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-1 border">Vehicle</th>
              <th className="text-right p-1 border">DB</th>
              <th className="text-right p-1 border">+Sim</th>
              <th className="text-right p-1 border">Proj</th>
              <th className="text-right p-1 border">Cap</th>
              <th className="text-right p-1 border">Gap</th>
              <th className="text-right p-1 border">£/seat</th>
              <th className="text-left p-1 border">Groups</th>
            </tr>
          </thead>
          <tbody>
            {(t72 ? assigned.filter(v => t72.inPlayIds.has(v.vehicle_id)) : assigned).map(v => {
              const add = sim.perVehicle[v.vehicle_id]?.add ?? 0;
              const bookedDb = allocations[v.vehicle_id] ?? 0;
              const base = baseCountsForCalc[v.vehicle_id] ?? 0;
              const result = base + add;
              const cap = v.seats_capacity ?? 0;
              const gap = Math.max(0, cap - result);
              const unitEst = unitCentsForNextSeat(v, result, taxRate, feeRate, t72?.forcedDiscountIds?.has(v.vehicle_id) ?? false);
              const groupsPlaced = placedGroupsByBoat[v.vehicle_id] ?? [];
              const isPricing = pricingBoat?.vehicle_id === v.vehicle_id;
              return (
                <tr key={v.vehicle_id} className={isPricing ? "bg-yellow-50" : ""}>
                  <td className="p-1 border whitespace-nowrap">{v.vehicle_name}</td>
                  <td className="p-1 border text-right">{bookedDb}</td>
                  <td className="p-1 border text-right">{add}</td>
                  <td className="p-1 border text-right">{result}</td>
                  <td className="p-1 border text-right">{cap || "∞"}</td>
                  <td className={`p-1 border text-right ${gap <= 3 ? "text-red-700 font-semibold" : gap <= 5 ? "text-amber-700" : ""}`}>{gap}</td>
                  <td className="p-1 border text-right">{moneyFromMinor(unitEst)}</td>
                  <td className="p-1 border">
                    {groupsPlaced.length ? groupsPlaced.map((g, i) => (
                      <span key={i} className="inline-block text-[10px] border rounded px-1 py-[1px] mr-1 mb-1 bg-slate-100">{g}</span>
                    )) : <span className="text-[10px] text-gray-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Allocation Test / Validation</h1>

      {error && <div className="text-sm text-red-600 border border-red-300 rounded p-2 bg-red-50">{error}</div>}

      {/* All interactive controls, availability and live sim table together */}
      {Workbench}

      {/* Full Vehicles table with pricing details (below workbench) */}
      {selectedJourney && (
        <div>
          <h2 className="text-xl font-semibold">Vehicles (detail)</h2>
          <table className="min-w-full text-sm border">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2 border">Vehicle</th>
                <th className="text-left p-2 border">Operator</th>
                <th className="text-right p-2 border">Booked (DB)</th>
                <th className="text-right p-2 border">Min</th>
                <th className="text-right p-2 border">Cap</th>
                <th className="text-right p-2 border" title="Base for the next seat (before tax & fees), considering maxseatdiscount and T-72 discounts">
                  Base Rate (eff.)
                </th>
                <th className="text-right p-2 border">Min value (total)</th>
                <th className="text-right p-2 border">Allowed target</th>
                <th className="text-right p-2 border">Live gap</th>
              </tr>
            </thead>
            <tbody>
              {(t72 ? assigned.filter(v => t72.inPlayIds.has(v.vehicle_id)) : assigned).map(v => {
                const count = projectedWithSim[v.vehicle_id] ?? 0;
                const baseNext = baseCentsForNextSeat(v, count, t72?.forcedDiscountIds?.has(v.vehicle_id) ?? false);
                const minValueTotal = poundsToPence(v.base);
                const allowed = boatAllowedTargetPence(v);
                const hasThreshold = (v.min_val_threshold ?? 1) < 1;
                const cap = v.seats_capacity ?? 0;
                const gap = Math.max(0, cap - count);
                const isPricing = pricingBoat?.vehicle_id === v.vehicle_id;
                return (
                  <tr key={v.vehicle_id} className={isPricing ? "bg-yellow-50" : ""}>
                    <td className="p-2 border">{v.vehicle_name}</td>
                    <td className="p-2 border">{v.operator_name}</td>
                    <td className="p-2 border text-right">{allocations[v.vehicle_id] ?? 0}</td>
                    <td className="p-2 border text-right">{v.minseats ?? 0}</td>
                    <td className="p-2 border text-right">{cap || "∞"}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(baseNext)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(minValueTotal)}</td>
                    <td className={`p-2 border text-right ${hasThreshold ? "text-red-600 font-medium" : ""}`}>
                      {moneyFromMinor(allowed)} {hasThreshold && <span className="ml-1 text-xs">({Math.round((v.min_val_threshold ?? 1) * 100)}%)</span>}
                    </td>
                    <td className={`p-2 border text-right ${gap <= 3 ? "text-red-700 font-semibold" : gap <= 5 ? "text-amber-700" : ""}`}>{gap}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* SSOT pricing */}
            {/* T-24h final snapshot */}
      
      {/* Financials breakdown at T-24 */}
      {finalSnap && (
        <div className="space-y-2 border rounded p-3 bg-white shadow-sm">
          <h2 className="text-xl font-semibold">Financials (T-24)</h2>
          <table className="min-w-full text-sm border">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2 border">Vehicle</th>
                <th className="text-right p-2 border">Pax</th>
                <th className="text-right p-2 border">£/seat</th>
                <th className="text-right p-2 border">Base</th>
                <th className="text-right p-2 border">Tax</th>
                <th className="text-right p-2 border">Fees</th>
                <th className="text-right p-2 border">Revenue</th>
                <th className="text-right p-2 border">Commission</th>
              </tr>
            </thead>
            <tbody>
              {finalSnap.rows.map(r => {
                // Recompute per-seat base/tax/fees for the final result
                const v = assigned.find(a => a.vehicle_id === r.vehicle_id)!;
                const perSeatBase = baseCentsForNextSeat(v, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                const perSeatTax = perSeatBase == null ? null : Math.round(perSeatBase * taxRate);
                const perSeatFees = perSeatBase == null ? null : Math.round((perSeatBase + (perSeatTax ?? 0)) * feeRate);
                const rowBase = perSeatBase == null ? null : perSeatBase * r.result;
                const rowTax = perSeatTax == null ? null : perSeatTax * r.result;
                const rowFees = perSeatFees == null ? null : perSeatFees * r.result;
                const commission = rowBase == null ? null : Math.round(rowBase * commissionRate);
                return (
                  <tr key={r.vehicle_id}>
                    <td className="p-2 border">{r.vehicle_name}</td>
                    <td className="p-2 border text-right">{r.result}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(r.unit)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(rowBase)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(rowTax)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(rowFees)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(r.revenue)}</td>
                    <td className="p-2 border text-right">{moneyFromMinor(commission)}</td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="bg-gray-50 font-medium">
                <td className="p-2 border text-right">Totals</td>
                <td className="p-2 border text-right">
                  {finalSnap.rows.reduce((a, r) => a + r.result, 0)}
                </td>
                <td className="p-2 border"></td>
                <td className="p-2 border text-right">
                  {moneyFromMinor(finalSnap.rows.reduce((a, r) => {
                    const v = assigned.find(a2 => a2.vehicle_id === r.vehicle_id)!;
                    const base = baseCentsForNextSeat(v, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                    return a + (base == null ? 0 : base * r.result);
                  }, 0))}
                </td>
                <td className="p-2 border text-right">
                  {moneyFromMinor(finalSnap.rows.reduce((a, r) => {
                    const v = assigned.find(a2 => a2.vehicle_id === r.vehicle_id)!;
                    const base = baseCentsForNextSeat(v, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                    const tax = base == null ? 0 : Math.round(base * taxRate);
                    return a + tax * r.result;
                  }, 0))}
                </td>
                <td className="p-2 border text-right">
                  {moneyFromMinor(finalSnap.rows.reduce((a, r) => {
                    const v = assigned.find(a2 => a2.vehicle_id === r.vehicle_id)!;
                    const base = baseCentsForNextSeat(v, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                    const tax = base == null ? 0 : Math.round(base * taxRate);
                    const fees = Math.round(( (base ?? 0) + tax ) * feeRate);
                    return a + fees * r.result;
                  }, 0))}
                </td>
                <td className="p-2 border text-right">
                  {moneyFromMinor(finalSnap.rows.reduce((a, r) => a + (r.revenue ?? 0), 0))}
                </td>
                <td className="p-2 border text-right">
                  {moneyFromMinor(finalSnap.rows.reduce((a, r) => {
                    const veh = assigned.find(a2 => a2.vehicle_id === r.vehicle_id)!;
                    const base = baseCentsForNextSeat(veh, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                    const rowBase = base == null ? 0 : base * r.result;
                    const rate = veh.operator_commission ?? commissionRate;
                    return a + Math.round(rowBase * rate);
                  }, 0))}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="text-xs text-gray-500">Note: Commission uses the operator’s live rate (operators.commisison) when available; otherwise the workbench Commission %.</div>
        </div>
      )}
{finalSnap && (
        <div ref={finalRef} className="space-y-3 border rounded p-4 bg-white shadow-sm">
          <h2 className="text-xl font-semibold">Finalised allocation (T-24h snapshot)</h2>
          <div className="text-sm text-gray-600">Captured at {new Date(finalSnap.at).toLocaleString()}</div>

          <div className="mt-2 text-sm">
            <h3 className="font-semibold">Finalisation policy (applied at T-24h)</h3>
            <ul className="list-disc ml-6">
              <li>Keep each paid group together (never split).</li>
              <li>Minimise boats used while meeting financial targets.</li>
              <li>Pre-T72: if a new boat must be opened, prefer one that meets its allowed target with the group, else the cheapest.</li>
              <li>Post-T72: never open new boats; only in-play boats are used.</li>
              <li>Respect capacity; use thresholds (min_val_threshold) if a boat can’t meet full minimum, and report any shortfalls.</li>
            </ul>
          </div>

          <table className="min-w-full text-sm border">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left p-2 border">Vehicle</th>
                <th className="text-left p-2 border">Operator</th>
                <th className="text-right p-2 border">Result</th>
                <th className="text-right p-2 border">Min</th>
                <th className="text-right p-2 border">Cap</th>
                <th className="text-right p-2 border">Allowed target</th>
                <th className="text-right p-2 border">£/seat</th>
                <th className="text-right p-2 border">Base</th>
                <th className="text-right p-2 border">Tax</th>
                <th className="text-right p-2 border">Fees</th>
                <th className="text-right p-2 border">Commission</th>
                <th className="text-right p-2 border">Revenue</th>
                <th className="text-right p-2 border">Min revenue</th>
                <th className="text-right p-2 border">Δ above min</th>
              </tr>
            </thead>
            <tbody>
              {finalSnap.rows.map(r => (
                <tr key={r.vehicle_id}>
                  <td className="p-2 border">{r.vehicle_name}</td>
                  <td className="p-2 border">{r.operator_name}</td>
                  <td className="p-2 border text-right">{r.result}</td>
                  <td className="p-2 border text-right">{r.min}</td>
                  <td className="p-2 border text-right">{r.cap ?? "∞"}</td>
                  <td className={`p-2 border text-right ${r.revenue != null && r.allowedTarget != null && r.revenue < r.allowedTarget ? "text-red-600 font-medium" : ""}`}>
                    {moneyFromMinor(r.allowedTarget)}
                  </td>
                  <td className="p-2 border text-right">{moneyFromMinor(r.unit)}</td>
                  {(() => {
                    const v = assigned.find(a => a.vehicle_id === r.vehicle_id)!;
                    const perSeatBase = baseCentsForNextSeat(v, r.result, t72?.forcedDiscountIds?.has(r.vehicle_id) ?? false);
                    const perSeatTax = perSeatBase == null ? 0 : Math.round(perSeatBase * taxRate);
                    const perSeatFees = perSeatBase == null ? 0 : Math.round((perSeatBase + perSeatTax) * feeRate);
                    const rowBase = perSeatBase == null ? 0 : perSeatBase * r.result;
                    const rowTax = perSeatTax * r.result;
                    const rowFees = perSeatFees * r.result;
                    const rowCommission = Math.round(rowBase * (v.operator_commission ?? commissionRate));
                    return <>
                      <td className="p-2 border text-right">{moneyFromMinor(rowBase)}</td>
                      <td className="p-2 border text-right">{moneyFromMinor(rowTax)}</td>
                      <td className="p-2 border text-right">{moneyFromMinor(rowFees)}</td>
                      <td className="p-2 border text-right">{moneyFromMinor(rowCommission)}</td>
                    </>;
                  })()}
                  <td className="p-2 border text-right">{moneyFromMinor(r.revenue)}</td>
                  <td className="p-2 border text-right">{moneyFromMinor(r.minRevenue)}</td>
                  <td className="p-2 border text-right">{moneyFromMinor(r.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3">
            <h3 className="font-semibold">Why these decisions?</h3>
            <ul className="list-disc ml-6 text-sm">
              {finalSnap.summary.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>

          <div className="pt-2"><button className="border rounded px-3 py-1" onClick={() => setFinalSnap(null)}>Clear snapshot</button></div>
        </div>
      )}
    </div>
  );
}
