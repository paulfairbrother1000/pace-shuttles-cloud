// src/app/admin/manifest/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

/* ---------- Types ---------- */
type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
type Route = { id: UUID; pickup_id: UUID; destination_id: UUID };
type Pickup = { id: UUID; name: string };
type Destination = { id: UUID; name: string };
type Operator = { id: UUID; name: string };

type Order = {
  id: UUID;
  status: "requires_payment" | "paid" | "cancelled" | "refunded" | "expired";
  route_id: UUID | null;
  journey_date: string | null;
  qty: number | null;
};

type OrderPassenger = {
  id: UUID;
  order_id: UUID;
  first_name: string | null;
  last_name: string | null;
  is_lead: boolean | null;
  email: string | null;
  phone: string | null;
};

type PerBoatRow = {
  journey_id: UUID;
  route_id: UUID;
  ymd: string;
  vehicle_id: UUID;
  vehicle_name: string;
  operator_id: UUID | null;
  preferred: boolean | null;
  min_seats: number | null;
  max_seats: number;
  allocated: number;
  remaining: number;
};

/** composite key table: (journey_id, vehicle_id, order_id) */
type AllocationRow = { journey_id: UUID; vehicle_id: UUID; order_id: UUID };

/* ---------- Supabase ---------- */
const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Utils ---------- */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toDateISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function horizonFor(tsISO: string): "T24" | "T72" | ">72h" | "past" {
  const now = new Date();
  const dep = new Date(tsISO);
  if (dep <= now) return "past";
  const h = (dep.getTime() - now.getTime()) / 36e5;
  if (h <= 24) return "T24";
  if (h <= 72) return "T72";
  return ">72h";
}

/* ---------- Greedy allocator (same logic as admin list) ---------- */
type Party = { order_id: UUID; size: number };
type Boat = { vehicle_id: UUID; cap: number; preferred: boolean };

function allocateDetailed(parties: Party[], boats: Boat[]) {
  const sorted = [...parties].filter(p => p.size > 0).sort((a, b) => b.size - a.size);

  const state = boats.map(b => ({
    vehicle_id: b.vehicle_id,
    cap: Math.max(0, Math.floor(Number(b.cap) || 0)),
    used: 0,
    preferred: !!b.preferred,
  }));

  const byBoat = new Map<
    UUID,
    { seats: number; orders: { order_id: UUID; size: number }[] }
  >();

  for (const g of sorted) {
    const candidates = state
      .map(s => ({ id: s.vehicle_id, free: s.cap - s.used, preferred: s.preferred, ref: s }))
      .filter(c => c.free >= g.size)
      .sort((a, b) => {
        if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
        if (a.free !== b.free) return a.free - b.free;
        return a.id.localeCompare(b.id);
      });

    if (!candidates.length) continue; // unassigned ignored for strict boat manifest
    const chosen = candidates[0];
    chosen.ref.used += g.size;

    const cur = byBoat.get(chosen.id) ?? { seats: 0, orders: [] };
    cur.seats += g.size;
    cur.orders.push({ order_id: g.order_id, size: g.size });
    byBoat.set(chosen.id, cur);
  }

  return byBoat;
}

/* ========================================================================================= */

export default function AdminManifestPage() {
  const search = useSearchParams();

  const journeyId =
    (
      search.get("journey") ??
      search.get("id") ??
      search.get("journeyId") ??
      search.get("jid") ??
      ""
    ).trim() || "";

  const vehicleId = (search.get("vehicle") ?? "").trim();

  const isValidJourney = UUID_RE.test(journeyId);
  const isValidVehicle = UUID_RE.test(vehicleId);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [journey, setJourney] = useState<Journey | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);

  const [operators, setOperators] = useState<Operator[]>([]);
  const [perBoat, setPerBoat] = useState<PerBoatRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderPassengers, setOrderPassengers] = useState<OrderPassenger[]>([]);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase client not configured");
        setLoading(false);
        return;
      }

      if (!isValidJourney) {
        setJourney(null);
        setRoute(null);
        setPickup(null);
        setDestination(null);
        setOperators([]);
        setPerBoat([]);
        setAllocations([]);
        setOrders([]);
        setOrderPassengers([]);
        setErr(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr(null);

      try {
        // 1) Journey
        const { data: jData, error: jErr } = await supabase
          .from("journeys")
          .select("id,route_id,departure_ts,is_active")
          .eq("id", journeyId)
          .maybeSingle();
        if (jErr) throw jErr;
        if (!jData) throw new Error("Journey not found");
        const j = jData as Journey;
        if (off) return;
        setJourney(j);

        // 2) Route + lookups
        const [rQ, puQ, deQ, oQ] = await Promise.all([
          supabase.from("routes").select("id,pickup_id,destination_id").eq("id", j.route_id).maybeSingle(),
          supabase.from("pickup_points").select("id,name"),
          supabase.from("destinations").select("id,name"),
          supabase.from("operators").select("id,name"),
        ]);
        if (rQ.error) throw rQ.error;
        if (puQ.error) throw puQ.error;
        if (deQ.error) throw deQ.error;
        if (oQ.error) throw oQ.error;

        const r = (rQ.data as Route) || null;
        setRoute(r);
        const puAll = (puQ.data || []) as Pickup[];
        const deAll = (deQ.data || []) as Destination[];
        setPickup(puAll.find(x => x.id === r?.pickup_id) ?? null);
        setDestination(deAll.find(x => x.id === r?.destination_id) ?? null);
        setOperators((oQ.data || []) as Operator[]);

        // 3) Capacity per boat (labels/totals + preferred flag & cap)
        const { data: capData, error: capErr } = await supabase
          .from("vw_journey_vehicle_remaining")
          .select("*")
          .eq("journey_id", journeyId)
          .order("preferred", { ascending: false })
          .order("remaining", { ascending: false });
        if (capErr) throw capErr;
        const boatsView = (capData || []) as PerBoatRow[];
        setPerBoat(boatsView);

        // 4) Allocations for this journey
        const { data: allocData, error: allocErr } = await supabase
          .from("journey_allocations")
          .select("journey_id,vehicle_id,order_id")
          .eq("journey_id", journeyId);
        if (allocErr) throw allocErr;
        const allocs = (allocData || []) as AllocationRow[];
        setAllocations(allocs);

        // 5) All paid orders for this route/day
        const ymd = toDateISO(new Date(j.departure_ts));
        const { data: oData, error: oErr } = await supabase
          .from("orders")
          .select("id,status,route_id,journey_date,qty")
          .eq("status", "paid")
          .eq("route_id", j.route_id)
          .eq("journey_date", ymd);
        if (oErr) throw oErr;
        const paid = (oData || []) as Order[];

        // 6) Determine which orders belong on the selected boat
        let allowedIds: Set<UUID> | null = null;

        if (isValidVehicle) {
          const persisted = allocs.filter(a => a.vehicle_id === vehicleId);
          if (persisted.length > 0) {
            // Use persisted allocation
            allowedIds = new Set(persisted.map(a => a.order_id));
          } else {
            // Recompute preview allocation deterministically
            const parties: Party[] = paid
              .map(o => ({ order_id: o.id, size: Math.max(0, Number(o.qty ?? 0)) }))
              .filter(p => p.size > 0);

            const boats: Boat[] = boatsView.map(b => ({
              vehicle_id: b.vehicle_id,
              cap: Number(b.max_seats ?? 0),
              preferred: !!b.preferred,
            }));

            const byBoat = allocateDetailed(parties, boats);
            const previewForBoat = byBoat.get(vehicleId);
            allowedIds = new Set((previewForBoat?.orders ?? []).map(o => o.order_id));
          }
        }

        // 7) Apply the boat filter strictly
        const filteredOrders =
          allowedIds ? paid.filter(o => allowedIds!.has(o.id)) : paid;
        setOrders(filteredOrders);

        // 8) Passengers for those orders (lead contact)
        if (filteredOrders.length) {
          const { data: pData, error: pErr } = await supabase
            .from("order_passengers")
            .select("id,order_id,first_name,last_name,is_lead,email,phone")
            .in("order_id", filteredOrders.map(o => o.id));
          if (pErr) throw pErr;
          setOrderPassengers((pData || []) as OrderPassenger[]);
        } else {
          setOrderPassengers([]);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();

    return () => { off = true; };
  }, [journeyId, vehicleId, isValidJourney, isValidVehicle]);

  /* ---------- Lead contact helper ---------- */
  const paxByOrder = useMemo(() => {
    const byOrder = new Map<UUID, OrderPassenger[]>();
    const leadByOrder = new Map<UUID, { name: string; email?: string | null; phone?: string | null }>();

    for (const p of orderPassengers) {
      const arr = byOrder.get(p.order_id) ?? [];
      arr.push(p);
      byOrder.set(p.order_id, arr);
    }
    for (const [orderId, pax] of byOrder.entries()) {
      let lead = pax.find(x => x.is_lead);
      if (!lead) lead = pax.find(x => (x.email && x.email.trim()) || (x.phone && x.phone.trim()));
      if (!lead && pax.length) lead = pax[0];
      if (lead) {
        const name = `${(lead.first_name || "").trim()} ${(lead.last_name || "").trim()}`.trim() || "Lead";
        leadByOrder.set(orderId, { name, email: lead.email ?? null, phone: lead.phone ?? null });
      }
    }
    return { byOrder, leadByOrder };
  }, [orderPassengers]);

  /* ---------- Lookups / header helpers ---------- */
  const operatorNameById = useMemo(() => {
    const m = new Map<UUID, string>();
    operators.forEach(o => m.set(o.id, o.name));
    return m;
  }, [operators]);

  const pickupName = pickup?.name ?? "—";
  const destinationName = destination?.name ?? "—";
  const depDate = journey ? new Date(journey.departure_ts).toLocaleDateString() : "—";
  const depTime = journey ? new Date(journey.departure_ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const horizon = journey ? horizonFor(journey.departure_ts) : ">72h";

  const selectedBoat = isValidVehicle
    ? perBoat.find(b => b.vehicle_id === vehicleId) || null
    : null;

  const totalMax = perBoat.reduce((s, r) => s + (r.max_seats ?? 0), 0);
  const totalAllocated = perBoat.reduce((s, r) => s + (r.allocated ?? 0), 0);
  const totalRemaining = Math.max(totalMax - totalAllocated, 0);

  return (
    <div className="px-4 py-6 mx-auto max-w-[1200px] space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Journey manifest
          {selectedBoat ? (
            <span className="ml-2 text-base font-normal text-neutral-600">
              — {selectedBoat.vehicle_name} (
              {selectedBoat.operator_id ? (operatorNameById.get(selectedBoat.operator_id) ?? "—") : "—"}
              )
            </span>
          ) : null}
        </h1>
        <a href="/admin" className="px-3 py-1.5 border rounded-lg hover:bg-neutral-50">← admin home</a>
      </div>

      <div className="text-neutral-700">
        <div className="text-lg font-medium">{pickupName} → {destinationName}</div>
        <div className="text-sm">
          Date: <strong>{depDate}</strong> · Time: <strong>{depTime}</strong> ·{" "}
          {horizon === "T24" ? (
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs">T-24</span>
          ) : horizon === "T72" ? (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs">T-72</span>
          ) : horizon === ">72h" ? (
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">&gt;72h</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700 text-xs">Past</span>
          )}
        </div>
      </div>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>
      )}

      {loading || !isValidJourney ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <>
          {/* Orders: STRICT boat view (persisted if present, else preview-based) */}
          <section className="rounded-2xl border bg-white shadow overflow-hidden">
            <div className="p-3 border-b bg-neutral-50 font-medium">
              Passenger groups (by order)
              {selectedBoat ? (
                <span className="ml-2 text-xs text-neutral-500">
                  Boat: {selectedBoat.vehicle_name}
                </span>
              ) : null}
            </div>
            {orders.length === 0 ? (
              <div className="p-4 text-neutral-600">
                {isValidVehicle ? "No bookings allocated to this boat." : "No bookings found for this journey."}
              </div>
            ) : (
              <div className="divide-y">
                {orders.map(o => {
                  const pax = paxByOrder.byOrder.get(o.id) || [];
                  const lead = paxByOrder.leadByOrder.get(o.id) || null;

                  return (
                    <div key={o.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm text-neutral-600">Order</div>
                          <div className="font-medium">#{o.id.slice(0, 8)}</div>
                          <div className="text-sm">
                            Party size: <strong>{Math.max(0, Number(o.qty ?? 0))}</strong>
                          </div>
                        </div>
                        <div className="min-w-[260px]">
                          <div className="text-sm text-neutral-600">Lead contact</div>
                          {lead ? (
                            <div className="text-sm">
                              <div className="font-medium">{lead.name}</div>
                              {lead.email && <div className="text-neutral-700">{lead.email}</div>}
                              {lead.phone && <div className="text-neutral-700">{lead.phone}</div>}
                              {!lead.email && !lead.phone && (
                                <div className="text-neutral-500 italic">No contact on file</div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-neutral-500 italic">No passenger names on file</div>
                          )}
                        </div>
                      </div>

                      {/* Passenger list */}
                      <div className="mt-3">
                        <div className="text-sm text-neutral-600 mb-1">Passengers</div>
                        {pax.length === 0 ? (
                          <div className="text-sm text-neutral-500 italic">No passenger names captured.</div>
                        ) : (
                          <ul className="list-disc ml-5 text-sm">
                            {pax.map(p => (
                              <li key={p.id}>
                                {`${(p.first_name || "").trim()} ${(p.last_name || "").trim()}`.trim() || "—"}
                                {p.is_lead ? " (lead)" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Capacity table (context only) */}
          <section className="rounded-2xl border bg-white shadow overflow-hidden">
            <div className="p-3 border-b bg-neutral-50 font-medium">
              Boats (capacity &amp; load) <span className="ml-2 text-xs text-neutral-500">From vw_journey_vehicle_remaining</span>
            </div>
            {perBoat.length === 0 ? (
              <div className="p-4 text-neutral-600">No boats are assigned to this route/journey.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left p-3">Boat</th>
                      <th className="text-left p-3">Operator</th>
                      <th className="text-right p-3">Allocated</th>
                      <th className="text-right p-3">Remaining</th>
                      <th className="text-right p-3">Min</th>
                      <th className="text-right p-3">Max</th>
                      <th className="text-left p-3">Preferred</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perBoat.map(b => {
                      const opName = b.operator_id ? (operatorNameById.get(b.operator_id) ?? "—") : "—";
                      return (
                        <tr key={b.vehicle_id} className={isValidVehicle && b.vehicle_id === vehicleId ? "border-t bg-blue-50/30" : "border-t"}>
                          <td className="p-3">{b.vehicle_name}</td>
                          <td className="p-3">{opName}</td>
                          <td className="p-3 text-right">{b.allocated}</td>
                          <td className="p-3 text-right">{b.remaining}</td>
                          <td className="p-3 text-right">{b.min_seats ?? 0}</td>
                          <td className="p-3 text-right">{b.max_seats}</td>
                          <td className="p-3">{b.preferred ? "yes" : "—"}</td>
                        </tr>
                      );
                    })}
                    <tr className="border-t font-medium">
                      <td className="p-3">Total</td>
                      <td className="p-3">—</td>
                      <td className="p-3 text-right">{totalAllocated}</td>
                      <td className="p-3 text-right">{totalRemaining}</td>
                      <td className="p-3 text-right">—</td>
                      <td className="p-3 text-right">{totalMax}</td>
                      <td className="p-3">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
