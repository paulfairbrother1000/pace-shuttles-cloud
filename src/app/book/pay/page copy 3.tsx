"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PayPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read required params from the URL
  const routeId = searchParams.get("routeId");
  const date = searchParams.get("date"); // YYYY-MM-DD
  const qtyParam = searchParams.get("qty");
  const token =
    searchParams.get("quoteToken") || searchParams.get("token") || null;
  const journeyIdFromUrl = searchParams.get("journeyId"); // optional, usually not present

  const [customerName, setCustomerName] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Parse seat quantity safely
  const qty = React.useMemo(() => {
    const n = Number(qtyParam ?? "1");
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtyParam]);

  const missingCoreInputs = !routeId || !date;

  async function handlePayNow() {
    setSubmitting(true);
    setErr(null);
    try {
      if (missingCoreInputs) {
        throw new Error("Missing routeId or date in the URL.");
      }

      // Always include routeId & date in the POST URL (API expects them in query too)
      const postUrl = `/api/checkout?${new URLSearchParams({
        routeId: routeId!,
        date: date!,
        ...(journeyIdFromUrl ? { journeyId: journeyIdFromUrl } : {}),
      }).toString()}`;

      const safeName = customerName.trim() || "Guest";

      const res = await fetch(postUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-quote-token": token } : {}),
        },
        body: JSON.stringify({
          seats: qty,
          customerName: safeName,
          // send token in body as well; server also checks header/query/referer/cookies
          ...(token ? { quoteToken: token } : {}),
          // if you ever capture journeyId on this page, you could also send it in body
          ...(journeyIdFromUrl ? { journeyId: journeyIdFromUrl } : {}),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        url?: string;
        orderId?: string;
        journeyId?: string;
        booked?: number;
      };

      if (!res.ok) {
        throw new Error(json?.error || "Checkout failed");
      }

      // Prefer server-provided URL if present; otherwise fallback to your receipt shape
      const fallbackUrl = `/orders/success2?${new URLSearchParams({
        orderId: json?.orderId ?? "", // booking id from API
        s: String(qty),               // seats
      }).toString()}`;

      const targetUrl =
        typeof json?.url === "string" && json.url.length > 0
          ? json.url
          : fallbackUrl;

      // Ensure we pass a string to router.replace (avoid .startsWith crash)
      if (typeof targetUrl !== "string" || !targetUrl) {
        throw new Error("Checkout succeeded but no redirect URL was provided.");
      }

      router.replace(targetUrl);
    } catch (e: any) {
      setErr(e?.message || "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Review & Pay</h1>

      {/* Trip summary */}
      <div className="rounded-lg border p-4">
        <div className="text-sm text-gray-600 mb-2">Trip details</div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Route ID</dt>
          <dd className="font-mono">{routeId ?? "—"}</dd>

          <dt className="text-gray-500">Date</dt>
          <dd>{date ?? "—"}</dd>

          <dt className="text-gray-500">Seats</dt>
          <dd>{qty}</dd>

          <dt className="text-gray-500">Quote token</dt>
          <dd className="truncate">{token ? "present" : "missing"}</dd>
        </dl>
      </div>

      {/* Customer details */}
      <div className="rounded-lg border p-4 space-y-3">
        <label className="block text-sm font-medium">
          Lead passenger name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500">
          We’ll use this name for the booking. (You can change this later in
          ops if needed.)
        </p>
      </div>

      {missingCoreInputs && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
          Missing <code>routeId</code> or <code>date</code> in the URL. Return
          to the previous step and try again.
        </div>
      )}

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
          {err}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handlePayNow}
          disabled={submitting || missingCoreInputs}
          className="rounded-md bg-black px-4 py-2 text-white text-sm disabled:opacity-50"
        >
          {submitting ? "Processing…" : "Pay now"}
        </button>

        <button
          onClick={() => router.back()}
          disabled={submitting}
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
        >
          Back
        </button>
      </div>

      <p className="text-xs text-gray-500">
        By continuing, you agree to our terms and acknowledge this is a test
        flow while we wire up payments.
      </p>
    </div>
  );
}
