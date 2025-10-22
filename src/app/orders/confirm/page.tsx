// src/app/orders/confirm/page.tsx
"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/** Outer component adds the Suspense boundary required by Next 13+/15 when using useSearchParams */
export default function OrdersConfirmPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-8">Loading…</div>}>
      <ConfirmInner />
    </Suspense>
  );
}

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type RouteRow = { id: string; route_name: string | null; pickup_time: string | null; approx_duration_mins: number | null };
type Minimal = { id: string; name: string };

function hhmmLocalToDisplay(hhmm: string | null | undefined) {
  if (!hhmm) return null;
  try {
    const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return hhmm ?? null;
  }
}

/* --- Pricing bits (same model; simplified for "next seat" on this route) --- */
const EPS = 1e-6;
type Bucket = {
  base: number; minvalue: number; maxseats: number; maxdisc: number;
  csat: number; prefRva: boolean; prefVeh: boolean; id: string; net: number;
  operator_id?: string | null;
};

function applyTaxFees(seatNet: number, tax: number, fees: number): number {
  const taxDue  = seatNet * (tax || 0);
  const feesDue = (seatNet + taxDue) * (fees || 0);
  return seatNet + taxDue + feesDue;
}

/** Inner component contains the original logic and safely calls useSearchParams */
function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();

  const routeId = params.get("routeId") || "";
  const dateISO = params.get("date") || "";
  const pickupId = params.get("pickupId") || "";
  const destinationId = params.get("destinationId") || "";
  const qty = Math.max(1, parseInt(params.get("qty") || "1", 10));

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [route, setRoute] = useState<RouteRow | null>(null);
  const [pickup, setPickup] = useState<Minimal | null>(null);
  const [dest, setDest] = useState<Minimal | null>(null);

  const [perSeat, setPerSeat] = useState<number | null>(null);
  const total = typeof perSeat === "number" ? perSeat * qty : null;

  useEffect(() => {
    (async () => {
      try {
        // Load route, pickup, dest labels
        const [{ data: rRow }, { data: pRow }, { data: dRow }] = await Promise.all([
          sb.from("routes").select("id,route_name,pickup_time,approx_duration_mins").eq("id", routeId).maybeSingle(),
          sb.from("pickup_points").select("id,name").eq("id", pickupId).maybeSingle(),
          sb.from("destinations").select("id,name").eq("id", destinationId).maybeSingle(),
        ]);
        setRoute((rRow as RouteRow) || null);
        setPickup((pRow as Minimal) || null);
        setDest((dRow as Minimal) || null);

        // Build buckets (same cheapest-vehicle logic)
        const [{ data: taxRows }, { data: asnRows }, { data: vehRows }, { data: opRows }] = await Promise.all([
          sb.from("tax_fees").select("tax,fees").limit(1),
          sb
            .from("route_vehicle_assignments")
            .select("route_id,vehicle_id,preferred,is_active")
            .eq("route_id", routeId)
            .eq("is_active", true),
          sb
            .from("vehicles")
            .select("id,operator_id,minseats,maxseats,minvalue,maxseatdiscount,preferred,active")
            .eq("active", true),
          sb.from("operators").select("id,csat"),
        ]);

        const tax = Number(taxRows?.[0]?.tax || 0);
        const fees = Number(taxRows?.[0]?.fees || 0);

        const ops = new Map<string, number>(
          (opRows || []).map((o: any) => [o.id, Number(o.csat || 0)])
        );
        const vehMap = new Map<string, any>((vehRows || []).map((v: any) => [v.id, v]));
        const asn = (asnRows || [])
          .map((a: any) => ({ ...a, v: vehMap.get(a.vehicle_id) }))
          .filter((a: any) => a.v);

        const buckets: Bucket[] = asn
          .map((a: any) => {
            const v = a.v;
            const minseats = Number(v.minseats || 0);
            const minvalue = Number(v.minvalue || 0);
            return {
              id: v.id,
              base: minseats ? minvalue / minseats : Number.POSITIVE_INFINITY,
              minvalue,
              maxseats: Number(v.maxseats || 0),
              maxdisc: Number(v.maxseatdiscount || 0),
              csat: ops.get(v.operator_id) || 0,
              prefRva: !!a.preferred,
              prefVeh: !!v.preferred,
              operator_id: v.operator_id,
              net: 0,
            };
          })
          .filter((b) => isFinite(b.base));

        if (!buckets.length) {
          setPerSeat(null);
          setLoading(false);
          return;
        }

        // Sort by base price, then csat, then preferred flags
        buckets.sort((a, b) => {
          if (Math.abs(a.base - b.base) > EPS) return a.base - b.base;
          if (a.csat !== b.csat) return b.csat - a.csat;
          if (a.prefRva !== b.prefRva) return a.prefRva ? -1 : 1;
          if (a.prefVeh !== b.prefVeh) return a.prefVeh ? -1 : 1;
          return 0;
        });

        // Next seat from cheapest bucket
        const cheapest = buckets[0];
        const seatNet =
          cheapest.net + cheapest.base < cheapest.minvalue - EPS
            ? cheapest.base
            : cheapest.base * (1 - cheapest.maxdisc);

        const user = applyTaxFees(seatNet, tax, fees);
        setPerSeat(Math.round(user * 100) / 100);
      } catch (e: any) {
        setMsg(e?.message ?? "Failed to prepare order");
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId, pickupId, destinationId]);

  async function payNow() {
    // TODO: replace with Stripe/PSP integration.
    // For now, just mimic a "payment" step and land on a success screen.
    const q = new URLSearchParams({
      routeId,
      date: dateISO,
      qty: String(qty),
    });
    router.push(`/orders/success2?${q.toString()}`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">Order confirmation</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="font-medium">{route?.route_name || "Journey"}</div>
            <div className="text-sm text-neutral-700">
              {dateISO ? new Date(dateISO + "T12:00:00").toLocaleDateString() : "—"}
              {route?.pickup_time ? ` • ${hhmmLocalToDisplay(route.pickup_time)}` : ""}
              <br />
              {pickup?.name && dest?.name ? `${pickup.name} → ${dest.name}` : null}
              {typeof route?.approx_duration_mins === "number" && (
                <>
                  {" "}
                  • Duration: <strong>{route.approx_duration_mins} mins</strong>
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                Tickets: <strong>{qty}</strong>
                <br />
                {typeof perSeat === "number" ? (
                  <>
                    Per seat: <strong>${perSeat.toFixed(2)}</strong>
                  </>
                ) : (
                  "Per-seat unavailable"
                )}
              </div>
              <div className="text-base">
                Total: <strong>{total !== null ? `$${total.toFixed(2)}` : "—"}</strong>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="rounded-lg border px-4 py-2" onClick={() => router.back()}>
              Back
            </button>
            <button
              className="rounded-lg bg-neutral-900 text-white px-4 py-2 disabled:opacity-60"
              disabled={typeof total !== "number"}
              onClick={payNow}
            >
              Pay now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
