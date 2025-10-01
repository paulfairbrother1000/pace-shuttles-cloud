// src/app/book/pay/page.tsx
"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

const money = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function PayPage() {
  const sp = useSearchParams();

  const qid = sp.get("qid") || "";
  const routeId = sp.get("routeId") || sp.get("route_id") || "";
  const dateISO = sp.get("date") || "";
  const qty = Math.max(1, parseInt(sp.get("qty") || sp.get("seats") || "1", 10));

  const tokenFromUrl = sp.get("token") || sp.get("quoteToken") || "";
  const allInFromUrl = sp.get("allInC");

  const [token, setToken] = React.useState<string>(tokenFromUrl);
  const [allInC, setAllInC] = React.useState<number | null>(
    allInFromUrl ? Number(allInFromUrl) : null
  );

  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Lead passenger
  const [lead, setLead] = React.useState({
    first: "",
    last: "",
    email: "",
    phone: "",
  });

  // Home address (lead)
  const [home, setHome] = React.useState({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postal: "",
    country: "",
  });

  // Billing address
  const [bill, setBill] = React.useState({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postal: "",
    country: "",
  });

  // Card fields (mock)
  const [card, setCard] = React.useState({
    number: "",
    name: "",
    exp: "",
    cvc: "",
  });

  // Guests (qty - 1 rows)
  const gCount = Math.max(0, qty - 1);
  const [guests, setGuests] = React.useState<
    { first_name: string; last_name: string }[]
  >(() => Array.from({ length: gCount }, () => ({ first_name: "", last_name: "" })));

  React.useEffect(() => {
    setGuests(Array.from({ length: gCount }, () => ({ first_name: "", last_name: "" })));
  }, [gCount]);

  // Fallback: confirm token/price if missing
  React.useEffect(() => {
    if (token && allInC != null) return;
    if (!routeId || !dateISO) return;
    let alive = true;
    (async () => {
      try {
        const u = new URL("/api/quote", window.location.origin);
        u.searchParams.set("routeId", routeId);
        u.searchParams.set("date", dateISO);
        u.searchParams.set("qty", String(qty));
        const res = await fetch(u.toString(), { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (j?.ok && j?.quote && j?.token) {
          setToken(j.token);
          setAllInC(j.quote.displayPounds ?? j.quote.allInC ?? j.allInC);
          setErr(null);
        } else {
          setErr("Could not confirm the seat price. Please go back and retry.");
        }
      } catch {
        if (alive) setErr("Could not confirm the seat price. Please go back and retry.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [routeId, dateISO, qty, token, allInC]);

  const total = allInC != null ? allInC * qty : null;
  const ready = !!token && allInC != null && !!routeId && !!dateISO && qty > 0;

  async function onPay() {
    setErr(null);
    if (!ready) {
      setErr("Price not confirmed. Please go back and retry.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qid, // optional
          routeId,
          date: dateISO,
          qty,
          token, // signed HMAC for (routeId,date,qty,allInC)
          allInC,

          // Lead + addresses
          lead_first_name: lead.first,
          lead_last_name: lead.last,
          lead_email: lead.email,
          lead_phone: lead.phone,

          home_addr_line1: home.line1,
          home_addr_line2: home.line2,
          home_city: home.city,
          home_region: home.region,
          home_postal: home.postal,
          home_country: home.country,

          bill_addr_line1: bill.line1,
          bill_addr_line2: bill.line2,
          bill_city: bill.city,
          bill_region: bill.region,
          bill_postal: bill.postal,
          bill_country: bill.country,

          // Guests (array)
          guests,

          // Mock card
          card,
        }),
      });
      const j = await res.json();
      if (!j?.ok) {
        setErr(j?.error || "Payment failed.");
        return;
      }
      // success -> Stage 3
      window.location.href = j.url;
    } catch (e: any) {
      setErr("Payment failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      <h1 className="text-3xl font-semibold">Payment</h1>

      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <div className="text-lg">
          Per-seat price <em>(incl. tax &amp; fees)</em>:{" "}
          <strong>{allInC != null ? money(allInC) : "—"}</strong>
        </div>
        <div className="text-lg">
          Tickets: <strong>{qty}</strong>
        </div>
        <div className="text-xl">
          Total: <strong>{total != null ? money(total) : "—"}</strong>
        </div>
        {err && <div className="text-sm text-red-600">{err}</div>}
      </section>

      {/* Lead passenger */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <div className="text-lg font-semibold">Lead passenger</div>
        <div className="grid md:grid-cols-2 gap-3">
          <input className="border rounded px-3 py-2" placeholder="First name"
            value={lead.first} onChange={(e) => setLead({ ...lead, first: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Last name"
            value={lead.last} onChange={(e) => setLead({ ...lead, last: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Email"
            value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Phone"
            value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} />
        </div>
      </section>

      {/* Home address */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <div className="text-lg font-semibold">Home address</div>
        <input className="border rounded px-3 py-2 w-full" placeholder="Address line 1"
          value={home.line1} onChange={(e) => setHome({ ...home, line1: e.target.value })} />
        <input className="border rounded px-3 py-2 w-full" placeholder="Address line 2"
          value={home.line2} onChange={(e) => setHome({ ...home, line2: e.target.value })} />
        <div className="grid md:grid-cols-3 gap-3">
          <input className="border rounded px-3 py-2" placeholder="City"
            value={home.city} onChange={(e) => setHome({ ...home, city: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Region"
            value={home.region} onChange={(e) => setHome({ ...home, region: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Postal code"
            value={home.postal} onChange={(e) => setHome({ ...home, postal: e.target.value })} />
        </div>
        <input className="border rounded px-3 py-2 w-full" placeholder="Country"
          value={home.country} onChange={(e) => setHome({ ...home, country: e.target.value })} />
      </section>

      {/* Billing address */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <div className="text-lg font-semibold">Billing address</div>
        <input className="border rounded px-3 py-2 w-full" placeholder="Address line 1"
          value={bill.line1} onChange={(e) => setBill({ ...bill, line1: e.target.value })} />
        <input className="border rounded px-3 py-2 w-full" placeholder="Address line 2"
          value={bill.line2} onChange={(e) => setBill({ ...bill, line2: e.target.value })} />
        <div className="grid md:grid-cols-3 gap-3">
          <input className="border rounded px-3 py-2" placeholder="City"
            value={bill.city} onChange={(e) => setBill({ ...bill, city: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Region"
            value={bill.region} onChange={(e) => setBill({ ...bill, region: e.target.value })} />
          <input className="border rounded px-3 py-2" placeholder="Postal code"
            value={bill.postal} onChange={(e) => setBill({ ...bill, postal: e.target.value })} />
        </div>
        <input className="border rounded px-3 py-2 w-full" placeholder="Country"
          value={bill.country} onChange={(e) => setBill({ ...bill, country: e.target.value })} />
      </section>

      {/* Guests */}
      {gCount > 0 && (
        <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
          <div className="text-lg font-semibold">Guests</div>
          {guests.map((g, i) => (
            <div key={i} className="grid md:grid-cols-2 gap-3">
              <input
                className="border rounded px-3 py-2"
                placeholder={`Guest ${i + 1} - First name`}
                value={g.first_name}
                onChange={(e) => {
                  const next = guests.slice();
                  next[i] = { ...next[i], first_name: e.target.value };
                  setGuests(next);
                }}
              />
              <input
                className="border rounded px-3 py-2"
                placeholder={`Guest ${i + 1} - Last name`}
                value={g.last_name}
                onChange={(e) => {
                  const next = guests.slice();
                  next[i] = { ...next[i], last_name: e.target.value };
                  setGuests(next);
                }}
              />
            </div>
          ))}
        </section>
      )}

      {/* Card */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <div className="text-lg font-semibold">Card</div>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Card number"
          value={card.number}
          onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))}
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="Name on card"
          value={card.name}
          onChange={(e) => setCard((c) => ({ ...c, name: e.target.value }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Expiry (MM/YY)"
            value={card.exp}
            onChange={(e) => setCard((c) => ({ ...c, exp: e.target.value }))}
          />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="CVC"
            value={card.cvc}
            onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))}
          />
        </div>
      </section>

      <div className="flex gap-3">
        <a href="/" className="px-5 py-3 rounded-2xl border hover:bg-neutral-50">
          Back
        </a>
        <button
          className="rounded bg-neutral-900 text-white px-5 py-3 disabled:opacity-60"
          disabled={!ready || loading}
          onClick={onPay}
        >
          {loading ? "Processing…" : "Pay now"}
        </button>
      </div>
    </div>
  );
}
