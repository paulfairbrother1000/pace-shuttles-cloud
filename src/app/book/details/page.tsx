// app/book/details/page.tsx
"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import WizardHeader from "@/components/WizardHeader";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type RouteRow = {
  id: string;
  route_name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  pickup_time: string | null;
  season_from?: string | null;
  season_to?: string | null;
  is_active?: boolean | null;
};
type Destination = { id: string; name: string; picture_url?: string | null; description?: string | null; url?: string | null; gift?: string | null; wet_or_dry?: "wet" | "dry" | null; };
type Pickup = { id: string; name: string; picture_url?: string | null; description?: string | null; };
type Assignment = { id: string; route_id: string; vehicle_id: string; preferred?: boolean | null; is_active?: boolean | null; };
type Vehicle = {
  id: string;
  name: string;
  operator_id?: string | null;
  type_id?: string | null;
  active?: boolean | null;
  minseats?: number | null;
  maxseats?: number | null;
  minvalue?: number | null;
  maxseatdiscount?: number | null;
  preferred?: boolean | null;
};
type Operator = { id: string; csat?: number | null };

/* ---------- Helpers ---------- */
function hhmmLocalToDisplay(hhmm: string | null | undefined) {
  if (!hhmm) return "—";
  try { const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10)); const d = new Date(); d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return hhmm; }
}
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null, bucket = "images"): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from(bucket).getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from(bucket).createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
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

/* ---------- Page ---------- */
export default function DetailsPage(): JSX.Element {
  const sp = useSearchParams();
  const router = useRouter();

  const countryId = sp.get("country_id") || "";
  const journeyTypeId = sp.get("journey_type_id") || "";
  const routeId = sp.get("routeId") || "";
  const dateISO = sp.get("date") || "";
  const pickupId = sp.get("pickupId") || "";
  const destinationId = sp.get("destinationId") || "";

  const [msg, setMsg] = React.useState<string | null>(null);
  const [route, setRoute] = React.useState<RouteRow | null>(null);
  const [dest, setDest] = React.useState<Destination | null>(null);
  const [pickup, setPickup] = React.useState<Pickup | null>(null);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [operatorsById, setOperatorsById] = React.useState<Record<string, Operator>>({});
  const [taxRate, setTaxRate] = React.useState(0);
  const [feesRate, setFeesRate] = React.useState(0);
  const [thumbs, setThumbs] = React.useState<Record<string, string | null>>({});
  const [qty, setQty] = React.useState<number>(1);
  const [perSeat, setPerSeat] = React.useState<number | null>(null);

  // Guard
  React.useEffect(() => {
    if (!routeId || !dateISO || !destinationId) router.replace(`/book/country`);
  }, [routeId, dateISO, destinationId, router]);

  // Base loads
  React.useEffect(() => {
    (async () => {
      const [rRes, dRes, pRes] = await Promise.all([
        sb.from("routes").select("*").eq("id", routeId).limit(1),
        sb.from("destinations").select("id,name,picture_url,description,url,gift,wet_or_dry").eq("id", destinationId).limit(1),
        pickupId ? sb.from("pickup_points").select("id,name,picture_url,description").eq("id", pickupId).limit(1) : Promise.resolve({ data: [], error: null }),
      ]);
      if (rRes.error || dRes.error || pRes.error) {
        setMsg(rRes.error?.message || dRes.error?.message || pRes.error?.message || "Load failed");
        return;
      }
      setRoute((rRes.data?.[0] as RouteRow) || null);
      setDest((dRes.data?.[0] as Destination) || null);
      setPickup((pRes.data?.[0] as Pickup) || null);
    })();
  }, [routeId, destinationId, pickupId]);

  // Assignments + Vehicles
  React.useEffect(() => {
    (async () => {
      if (!routeId) return;
      const { data: aData, error: aErr } = await sb
        .from("route_vehicle_assignments")
        .select("id,route_id,vehicle_id,preferred,is_active")
        .eq("route_id", routeId)
        .eq("is_active", true);
      if (aErr) { setMsg(aErr.message); return; }
      const asn = (aData as Assignment[]) || [];
      setAssignments(asn);

      const vehicleIds = Array.from(new Set(asn.map(a => a.vehicle_id)));
      if (!vehicleIds.length) { setVehicles([]); return; }
      const { data: vData, error: vErr } = await sb
        .from("vehicles")
        .select("id,name,operator_id,type_id,active,minseats,maxseats,minvalue,maxseatdiscount,preferred")
        .in("id", vehicleIds)
        .eq("active", true);
      if (vErr) { setMsg(vErr.message); setVehicles([]); return; }
      setVehicles((vData as Vehicle[]) || []);
    })();
  }, [routeId]);

  // Operators
  React.useEffect(() => {
    (async () => {
      const ids = Array.from(new Set(vehicles.map(v => v.operator_id).filter(Boolean))) as string[];
      if (!ids.length) { setOperatorsById({}); return; }
      const { data } = await sb.from("operators").select("id,csat").in("id", ids);
      const map: Record<string, Operator> = {};
      (data as Operator[] || []).forEach(op => { map[op.id] = op; });
      setOperatorsById(map);
    })();
  }, [vehicles]);

  // Tax/fees
  React.useEffect(() => {
    (async () => {
      const { data } = await sb.from("tax_fees").select("tax,fees").limit(1);
      if (data?.length) { setTaxRate(Number(data[0].tax || 0)); setFeesRate(Number(data[0].fees || 0)); }
    })();
  }, []);

  // Thumbs
  React.useEffect(() => {
    let off = false;
    (async () => {
      const want: [string, string | null][] = [];
      if (pickup) want.push([`pu_${pickup.id}`, pickup.picture_url ?? null]);
      if (dest) want.push([`dest_${dest.id}`, dest.picture_url ?? null]);
      const entries = await Promise.all(want.map(async ([k, v]) => [k, await resolveStorageUrl(v)]));
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => { off = true; };
  }, [pickup, dest]);

  // Booked seats and price
  async function fetchBookedSeatsByDate(routeId: string, targetISO: string): Promise<number> {
    try {
      const { data, error } = await sb.from("bookings").select("*").eq("route_id", routeId);
      if (error || !data) return 0;
      let sum = 0;
      (data as any[]).forEach(row => {
        if (row.status && String(row.status).toLowerCase().includes("cancel")) return;
        if ("departure_date" in row && row.departure_date) {
          if (row.departure_date === targetISO) sum += Number(row.seats || 0);
        } else if ("departure_at" in row && row.departure_at) {
          const iso = new Date(row.departure_at).toISOString().slice(0,10);
          if (iso === targetISO) sum += Number(row.seats || 0);
        }
      });
      return sum;
    } catch { return 0; }
  }

  function buildBuckets(): Bucket[] {
    const vById = new Map(vehicles.map(v => [v.id, v]));
    const buckets: Bucket[] = [];
    assignments.forEach(a => {
      const v = vById.get(a.vehicle_id);
      if (!v) return;
      const minseats = Number(v.minseats ?? 0);
      const maxseats = Number(v.maxseats ?? 0);
      const minvalue = Number(v.minvalue ?? 0);
      if (!minseats || !maxseats || !minvalue) return;
      const baseSeat = minvalue / minseats;
      const op = v.operator_id ? operatorsById[v.operator_id] : undefined;
      buckets.push({
        vehicle_id: v.id,
        operator_id: v.operator_id || null,
        csat: Number(op?.csat ?? 0),
        baseSeat,
        maxseats,
        minvalue,
        maxseatdiscount: Number(v.maxseatdiscount ?? 0),
        rvaPreferred: !!a.preferred,
        vehPreferred: !!v.preferred,
        allocated: 0,
        vehicleNet: 0,
      });
    });
    return buckets;
  }

  React.useEffect(() => {
    (async () => {
      if (!routeId || !dateISO) { setPerSeat(null); return; }
      const buckets = buildBuckets();
      if (!buckets.length) { setPerSeat(null); return; }

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
      if (idx < 0) { setPerSeat(null); return; }
      const b = buckets[idx];
      const nextSeatNet = (b.vehicleNet + b.baseSeat < b.minvalue - EPS)
        ? b.baseSeat
        : b.baseSeat * (1 - b.maxseatdiscount);
      const user = applyTaxFees(nextSeatNet, taxRate, feesRate);
      setPerSeat(Math.round(user * 100) / 100);
    })();
  }, [routeId, dateISO, assignments, vehicles, operatorsById, taxRate, feesRate]);

  const total = typeof perSeat === "number" ? perSeat * qty : null;

  // ⬇️ MAIN BUTTON → /book/pay (this is the only change you needed)
  function goToPayment() {
    const qp = new URLSearchParams({
      routeId,
      date: dateISO,
      pickupId: pickupId || "",
      destinationId: destinationId || "",
      qty: String(qty),
      country_id: countryId,
    });
    if (journeyTypeId) qp.set("journey_type_id", journeyTypeId);
    router.push(`/book/pay?${qp.toString()}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <WizardHeader step={5} />

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {(!route || !dest) ? (
        <section className="rounded-2xl border p-4 bg-white">Loading…</section>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {new Date(dateISO + "T12:00:00").toLocaleDateString()}
              {route.pickup_time ? ` • ${hhmmLocalToDisplay(route.pickup_time)}` : ""}
            </h3>
            <div className="text-sm text-neutral-700">
              Duration: <strong>{route.approx_duration_mins ?? "—"} mins</strong>
              {typeof perSeat === "number" && <> • Price: <strong>${perSeat.toFixed(2)} / seat</strong></>}
            </div>
          </div>

          {/* TWO tiles */}
          <div className="grid gap-6 md:grid-cols-2">
            {pickup && (
              <div className="rounded-2xl border bg-white shadow p-4 space-y-3">
                <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden bg-neutral-100">
                  {isHttp(pickup.picture_url || "") ? (
                    <img src={pickup.picture_url!} alt={pickup.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : thumbs[`pu_${pickup.id}`] ? (
                    <img src={thumbs[`pu_${pickup.id}`] as string} alt={pickup.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Pick-up</div>
                  <h4 className="text-base font-semibold">{pickup.name}</h4>
                  {pickup.description && <p className="text-sm text-neutral-700">{pickup.description}</p>}
                </div>
              </div>
            )}

            {dest && (
              <div className="rounded-2xl border bg-white shadow p-4 space-y-3">
                <div className="relative w-full aspect-[16/9] rounded-xl overflow-hidden bg-neutral-100">
                  {isHttp(dest.picture_url || "") ? (
                    <img src={dest.picture_url!} alt={dest.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : thumbs[`dest_${dest.id}`] ? (
                    <img src={thumbs[`dest_${dest.id}`] as string} alt={dest.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-neutral-500">Destination</div>
                  <h4 className="text-base font-semibold">{dest.name}</h4>
                  {dest.description && <p className="text-sm text-neutral-700">{dest.description}</p>}
                  {dest.gift && <p className="text-sm text-emerald-700">🎁 {dest.gift}</p>}
                  {dest.wet_or_dry === "wet" && (
                    <p className="text-sm text-amber-700">
                      There is no dock at this destination. Guests are invited to wade from the boat to the beach with the assistance of the crew. You will get wet leaving the boat at your destination.
                    </p>
                  )}
                  {dest.url && (
                    <a href={dest.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">{dest.url}</a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Qty + CTA */}
          <div className="rounded-2xl border bg-white shadow p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-700">Tickets</span>
                <div className="inline-flex items-center border rounded-lg overflow-hidden">
                  <button type="button" className="px-3 py-1 text-lg" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Decrease">−</button>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="w-14 text-center outline-none py-1"
                  />
                  <button type="button" className="px-3 py-1 text-lg" onClick={() => setQty(q => q + 1)} aria-label="Increase">+</button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-sm">
                  {typeof perSeat === "number" ? (
                    <>
                      <div>Price: <strong>${perSeat.toFixed(2)}</strong> / seat</div>
                      <div className="text-neutral-600">Total: <strong>${(total ?? 0).toFixed(2)}</strong></div>
                    </>
                  ) : (
                    <div className="text-neutral-600">Price unavailable</div>
                  )}
                </div>

                <button
                  className="rounded-lg bg-neutral-900 text-white px-4 py-2 disabled:opacity-60"
                  disabled={typeof perSeat !== "number"}
                  onClick={goToPayment}
                >
                  Continue to checkout
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
