// src/app/book/confirm/page.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WizardHeader from "@/components/WizardHeader";

type Quote = {
  route_id: string;
  date: string;
  qty: number;
  currency: "GBP";
  base_pp: number;     // excl. tax & fees
  tax_pp: number;
  fees_pp: number;
  all_in_pp: number;   // ✅ authoritative per-seat (incl. tax & fees, already rounded up)
  denom: number;
  expires_at: string;
  sig: string;
};

const cx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

const fmtGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(n);

export default function ConfirmPage(): JSX.Element {
  const router = useRouter();
  const sp = useSearchParams();

  // Journey context (exact same params we’ll pass to /book/pay)
  const routeId = sp.get("routeId") || sp.get("route_id") || sp.get("route") || "";
  const dateISO = sp.get("date") || "";
  const qty = Math.max(1, parseInt(sp.get("qty") || "1", 10));
  const pickupId = sp.get("pickupId") || "";
  const destinationId = sp.get("destinationId") || "";

  // Optional niceties (only used for display if the previous step provided them)
  const pickupName = sp.get("pickupName") || sp.get("from") || "";
  const destinationName = sp.get("destinationName") || sp.get("to") || "";
  const timeText = sp.get("time") || ""; // e.g. "12:00"

  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Fetch the authoritative, signed price
  React.useEffect(() => {
    if (!routeId || !dateISO || !qty) {
      setErr("Missing journey details. Please go back and choose a trip again.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const u = new URL("/api/quote", window.location.origin);
        u.searchParams.set("routeId", routeId);
        u.searchParams.set("date", dateISO);
        u.searchParams.set("qty", String(qty));

        const res = await fetch(u.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json?.ok && json?.quote) {
          setQuote(json.quote as Quote);
          setErr(null);
        } else {
          setErr(json?.error || "Could not confirm the price for this journey.");
        }
      } catch {
        setErr("Could not confirm the price for this journey.");
      } finally {
        setLoading(false);
      }
    })();
  }, [routeId, dateISO, qty]);

  function proceedToPayment() {
    // We do NOT pass the price along in the URL anymore.
    // The Pay page will call /api/quote again and see the same value.
    const params = new URLSearchParams({
      routeId,
      date: dateISO,
      qty: String(qty),
    });
    if (pickupId) params.set("pickupId", pickupId);
    if (destinationId) params.set("destinationId", destinationId);
    router.push(`/book/pay?${params.toString()}`);
  }

  const perSeat = quote?.all_in_pp ?? null;
  const total = perSeat != null ? perSeat * qty : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <WizardHeader step={4} title="Order confirmation" />

      {/* Journey summary card */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-2">
        <div className="text-xl font-semibold">
          {pickupName && destinationName
            ? `${pickupName} → ${destinationName}`
            : "Your selected journey"}
        </div>
        <div className="text-neutral-700">
          {dateISO ? new Date(dateISO).toLocaleDateString("en-GB") : "—"}
          {timeText ? ` • ${timeText}` : ""}
        </div>
        {pickupName && destinationName && (
          <div className="text-neutral-700">
            {pickupName} → {destinationName}
          </div>
        )}
      </section>

      {/* Price + controls */}
      <section className="rounded-2xl border bg-white p-5 shadow">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="space-y-2">
            <div className="text-lg">
              Tickets: <strong>{qty}</strong>
            </div>
            <div className="text-lg">
              Per ticket (incl. tax &amp; fees):{" "}
              <strong>
                {loading ? "Confirming price…" : perSeat != null ? fmtGBP(perSeat) : "—"}
              </strong>
            </div>
          </div>

          <div className="text-2xl font-semibold">
            Total: {loading ? "—" : total != null ? fmtGBP(total) : "—"}
          </div>
        </div>

        {err && (
          <p className="mt-4 text-sm text-red-600">
            {err} Try going back and selecting the trip again.
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => history.back()}
            className="rounded-xl border px-4 py-2"
          >
            Back
          </button>
          <button
            type="button"
            onClick={proceedToPayment}
            disabled={!quote || !!err}
            className={cx(
              "rounded-xl px-5 py-2 text-white",
              !quote || !!err ? "bg-neutral-400 cursor-not-allowed" : "bg-neutral-900"
            )}
          >
            Proceed to payment
          </button>
        </div>
      </section>
    </div>
  );
}
