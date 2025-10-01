// src/app/book/pay/page.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

type Guest = { first_name: string; last_name: string };

export default function PayPage(): JSX.Element {
  const router = useRouter();
  const qs = useSearchParams();

  // params pushed from /checkout
  const qid = qs.get("qid") || "";
  const routeId = qs.get("routeId") || "";
  const dateISO = qs.get("date") || ""; // YYYY-MM-DD
  const qty = Math.max(1, Number(qs.get("qty") || "1"));
  const token = qs.get("token") || qs.get("quoteToken") || ""; // quote token
  const allInC = Number(qs.get("allInC") || qs.get("perSeatAllIn") || "0"); // per-seat all-in (GBP)
  const ccy = (qs.get("ccy") || "GBP").toUpperCase();

  const total = React.useMemo(() => allInC * qty, [allInC, qty]);

  // lead + contact
  const [leadFirst, setLeadFirst] = React.useState("");
  const [leadLast, setLeadLast] = React.useState("");
  const [leadEmail, setLeadEmail] = React.useState("");
  const [leadPhone, setLeadPhone] = React.useState("");

  // additional passengers
  const [guests, setGuests] = React.useState<Guest[]>(
    Array.from({ length: Math.max(0, qty - 1) }, () => ({ first_name: "", last_name: "" }))
  );
  React.useEffect(() => {
    setGuests((prev) =>
      Array.from({ length: Math.max(0, qty - 1) }, (_, i) => prev[i] ?? { first_name: "", last_name: "" })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  // which person is lead? "lead" (the lead form) or a guest index 0..(qty-2)
  const [leadChoice, setLeadChoice] = React.useState<"lead" | number>("lead");

  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function updateGuest(i: number, patch: Partial<Guest>) {
    setGuests((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  async function handlePayNow() {
    setErr(null);

    // Required quote bits (must match server-side signed token context)
    if (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInC)) {
      setErr("Missing route/date/qty/token/price");
      return;
    }

    // Require names for everyone (so the manifest is complete)
    if (!leadFirst.trim() || !leadLast.trim()) {
      setErr("Lead passenger first/last name required.");
      return;
    }
    for (let i = 0; i < guests.length; i++) {
      if (!guests[i].first_name.trim() || !guests[i].last_name.trim()) {
        setErr(`Guest ${i + 1} needs first and last name.`);
        return;
      }
    }

    // Build passengers with exactly one lead
    const passengers = [
      { first_name: leadFirst.trim(), last_name: leadLast.trim(), is_lead: leadChoice === "lead" },
      ...guests.map((g, i) => ({
        first_name: g.first_name.trim(),
        last_name: g.last_name.trim(),
        is_lead: leadChoice === i, // guest index
      })),
    ];
    if (passengers.filter((p) => p.is_lead).length !== 1) {
      setErr("Please mark exactly one person as the lead passenger.");
      return;
    }

    setSubmitting(true);
    try {
      // ✅ Post to the unified checkout endpoint in snake_case
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // quote contract (server verifies this against the signature)
          qid,
          routeId,
          date: dateISO,
          qty,
          token,           // signed quote token
          allInC,          // per-seat all-in (units)
          ccy,             // currency code, defaults to GBP

          // lead contact (mirrored to orders.* by the API)
          lead_first_name: leadFirst.trim(),
          lead_last_name: leadLast.trim(),
          lead_email: leadEmail.trim() || null,
          lead_phone: leadPhone.trim() || null,

          // names for manifest -> order_passengers
          passengers, // [{ first_name, last_name, is_lead }]
        }),
      });

      // Not logged in → go to /login and bounce back here
      if (res.status === 401) {
        const returnTo =
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "/book/pay";
        router.replace(`/login?next=${encodeURIComponent(returnTo)}`);
        return;
      }

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok || !json?.ok || !json?.url) {
        throw new Error(json?.error || "Payment failed.");
      }

      // Success → server gives us canonical success URL
      router.replace(json.url);
    } catch (e: any) {
      setErr(e?.message || "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-3xl font-extrabold">Review &amp; Pay</h1>

      {/* Trip summary */}
      <div className="rounded-2xl border p-4">
        <div className="text-sm text-gray-600 mb-2">Trip details</div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Route ID</dt>
          <dd className="font-mono break-all">{routeId || "—"}</dd>

          <dt className="text-gray-500">Date</dt>
          <dd>{dateISO || "—"}</dd>

          <dt className="text-gray-500">Seats</dt>
          <dd>{qty}</dd>

          <dt className="text-gray-500">Per seat</dt>
          <dd>{Number.isFinite(allInC) ? gbp(allInC) : "—"}</dd>

          <dt className="text-gray-500">Total</dt>
          <dd className="font-semibold">{Number.isFinite(total) ? gbp(total) : "—"}</dd>

          <dt className="text-gray-500">Quote token</dt>
          <dd className="truncate">{token ? "present" : "missing"}</dd>
        </dl>
      </div>

      {/* Lead + guests */}
      <div className="rounded-2xl border p-4 space-y-4">
        <div className="text-sm font-medium">Lead passenger *</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="input"
            placeholder="First name"
            value={leadFirst}
            onChange={(e) => setLeadFirst(e.target.value)}
          />
        <input
            className="input"
            placeholder="Last name"
            value={leadLast}
            onChange={(e) => setLeadLast(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="input"
            placeholder="Email (optional)"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
          />
          <input
            className="input"
            placeholder="Phone (optional)"
            value={leadPhone}
            onChange={(e) => setLeadPhone(e.target.value)}
          />
        </div>

        {guests.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Additional passengers</div>
            {guests.map((g, i) => (
              <div key={i} className="grid grid-cols-[1rem_1fr_1fr] gap-3 items-center">
                <input
                  type="radio"
                  name="leadPick"
                  aria-label="Mark as lead"
                  checked={leadChoice === i}
                  onChange={() => setLeadChoice(i)}
                />
                <input
                  className="input"
                  placeholder={`Guest ${i + 1} – first name`}
                  value={g.first_name}
                  onChange={(e) => updateGuest(i, { first_name: e.target.value })}
                />
                <input
                  className="input"
                  placeholder={`Guest ${i + 1} – last name`}
                  value={g.last_name}
                  onChange={(e) => updateGuest(i, { last_name: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        {/* Lead selector for the lead fields themselves */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="radio"
            name="leadPick"
            checked={leadChoice === "lead"}
            onChange={() => setLeadChoice("lead")}
          />
          <span className="text-sm">Set the above person as lead</span>
        </div>

        <p className="text-xs text-gray-500">
          We’ll use these names for the manifest. Exactly one person is marked as the lead for comms.
        </p>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{err}</div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handlePayNow} disabled={submitting} className="btn-primary" type="button">
          {submitting ? "Processing…" : "Proceed to payment"}
        </button>
        <button onClick={() => router.back()} disabled={submitting} className="btn-secondary" type="button">
          Back
        </button>
      </div>

      <p className="text-xs text-gray-500">
        By continuing, you agree to our terms and acknowledge this is a test flow while we wire up payments.
      </p>

      <style jsx global>{`
        .input { border:1px solid #e5e7eb; border-radius:.75rem; padding:.6rem .9rem; width:100%; }
        .btn-primary { border-radius: .75rem; background:#000; color:#fff; padding:.5rem 1rem; font-size:.9rem; }
        .btn-secondary { border-radius: .75rem; border:1px solid #e5e7eb; padding:.5rem 1rem; font-size:.9rem; }
      `}</style>
    </div>
  );
}
