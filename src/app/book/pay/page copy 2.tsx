// src/app/book/pay/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Guest = { full_name: string };

const CCIcons = () => {
  // inline SVGs for Visa, Mastercard, Amex
  return (
    <div className="flex items-center gap-3">
      {/* Visa */}
      <svg width="42" height="26" viewBox="0 0 48 30" className="drop-shadow">
        <rect rx="4" width="48" height="30" fill="#1a1a1a" />
        <text x="9" y="20" fontFamily="Arial, Helvetica, sans-serif" fontSize="14" fill="#fff">
          VISA
        </text>
      </svg>
      {/* Mastercard */}
      <svg width="42" height="26" viewBox="0 0 48 30" className="drop-shadow">
        <rect rx="4" width="48" height="30" fill="#1a1a1a" />
        <circle cx="20" cy="15" r="7" fill="#EB001B" />
        <circle cx="28" cy="15" r="7" fill="#F79E1B" />
      </svg>
      {/* American Express */}
      <svg width="42" height="26" viewBox="0 0 48 30" className="drop-shadow">
        <rect rx="4" width="48" height="30" fill="#0077a6" />
        <text x="3" y="19" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fill="#fff">
          AMERICAN
        </text>
        <text x="5" y="26" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fill="#fff">
          EXPRESS
        </text>
      </svg>
    </div>
  );
};

const toGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function PayPage() {
  const router = useRouter();
  const qs = useSearchParams();

  const qid = qs.get("qid") || "";
  const routeId = qs.get("routeId") || "";
  const dateISO = qs.get("date") || "";
  const qty = Number(qs.get("qty") || "1");
  const token = qs.get("token") || qs.get("quoteToken") || "";
  const allInC = Number(qs.get("allInC") || qs.get("perSeatAllIn") || "0"); // per-seat all-in (GBP)

  const total = useMemo(() => allInC * qty, [allInC, qty]);

  // Lead passenger
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Home address
  const [h1, setH1] = useState("");
  const [h2, setH2] = useState("");
  const [hCity, setHCity] = useState("");
  const [hRegion, setHRegion] = useState("");
  const [hPost, setHPost] = useState("");
  const [hCountry, setHCountry] = useState("United Kingdom");

  // Billing address
  const [sameAsHome, setSameAsHome] = useState(true);
  const [b1, setB1] = useState("");
  const [b2, setB2] = useState("");
  const [bCity, setBCity] = useState("");
  const [bRegion, setBRegion] = useState("");
  const [bPost, setBPost] = useState("");
  const [bCountry, setBCountry] = useState("United Kingdom");

  // Guests (qty - 1)
  const [guests, setGuests] = useState<Guest[]>(
    Array.from({ length: Math.max(0, qty - 1) }, () => ({ full_name: "" }))
  );
  useEffect(() => {
    setGuests(Array.from({ length: Math.max(0, qty - 1) }, (_, i) => guests[i] ?? { full_name: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty]);

  // Card fields (dummy UI)
  const [card, setCard] = useState("");
  const [nameOnCard, setNameOnCard] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-copy home -> billing when the checkbox is on
  useEffect(() => {
    if (sameAsHome) {
      setB1(h1);
      setB2(h2);
      setBCity(hCity);
      setBRegion(hRegion);
      setBPost(hPost);
      setBCountry(hCountry);
    }
  }, [sameAsHome, h1, h2, hCity, hRegion, hPost, hCountry]);

  async function handlePayNow() {
    setErr(null);

    if (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInC)) {
      setErr("Missing required quote information.");
      return;
    }
    if (!first || !last || !email) {
      setErr("Please enter the lead passenger name and email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // required by /api/checkout (already working)
          qid,
          routeId,
          date: dateISO,
          qty,
          token,
          allInC,

          // additional (optional) payload your API can safely ignore for now
          lead_first_name: first,
          lead_last_name: last,
          lead_email: email,
          lead_phone: phone,

          home_addr_line1: h1,
          home_addr_line2: h2,
          home_city: hCity,
          home_region: hRegion,
          home_postal: hPost,
          home_country: hCountry,

          bill_addr_line1: b1,
          bill_addr_line2: b2,
          bill_city: bCity,
          bill_region: bRegion,
          bill_postal: bPost,
          bill_country: bCountry,

          guests, // [{ full_name }]
          // fake card fields (non-sensitive, for UI only)
          card_last4: card.replace(/\s+/g, "").slice(-4),
          name_on_card: nameOnCard,
          exp,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setErr(json?.error || "Payment failed.");
        setSubmitting(false);
        return;
      }

      // Your /api/checkout returns url: `/orders/success2?orderId=...&s=...`
      router.replace(json.url);
    } catch (e: any) {
      setErr(e?.message || "Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-4xl font-extrabold mb-6">Payment</h1>

      <div className="rounded-2xl border bg-white p-6 shadow space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl">
              Confirmed per-seat price <span className="italic">(incl. tax & fees)</span>:{" "}
              <strong>{toGBP(allInC)}</strong>
            </div>
            <div className="text-2xl mt-2">
              Total: <strong>{toGBP(total)}</strong>
            </div>
          </div>
          <CCIcons />
        </div>

        {/* Lead passenger */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Lead passenger</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
            <input className="input" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </section>

        {/* Home address */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Home address</h2>
          <input className="input" placeholder="Address line 1" value={h1} onChange={(e) => setH1(e.target.value)} />
          <input className="input" placeholder="Address line 2 (optional)" value={h2} onChange={(e) => setH2(e.target.value)} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="input" placeholder="City" value={hCity} onChange={(e) => setHCity(e.target.value)} />
            <input className="input" placeholder="Region" value={hRegion} onChange={(e) => setHRegion(e.target.value)} />
            <input className="input" placeholder="Postal code" value={hPost} onChange={(e) => setHPost(e.target.value)} />
          </div>
          <input className="input" placeholder="Country" value={hCountry} onChange={(e) => setHCountry(e.target.value)} />
        </section>

        {/* Guests */}
        {guests.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Additional passengers</h2>
            <div className="space-y-2">
              {guests.map((g, i) => (
                <input
                  key={i}
                  className="input"
                  placeholder={`Guest ${i + 1} full name`}
                  value={g.full_name}
                  onChange={(e) => {
                    const next = guests.slice();
                    next[i] = { full_name: e.target.value };
                    setGuests(next);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Billing address */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Billing address</h2>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sameAsHome}
              onChange={(e) => setSameAsHome(e.target.checked)}
            />
            <span>Billing address is the same as home</span>
          </label>

          <input
            className="input"
            placeholder="Address line 1"
            value={b1}
            onChange={(e) => setB1(e.target.value)}
            disabled={sameAsHome}
          />
          <input
            className="input"
            placeholder="Address line 2 (optional)"
            value={b2}
            onChange={(e) => setB2(e.target.value)}
            disabled={sameAsHome}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="input"
              placeholder="City"
              value={bCity}
              onChange={(e) => setBCity(e.target.value)}
              disabled={sameAsHome}
            />
            <input
              className="input"
              placeholder="Region"
              value={bRegion}
              onChange={(e) => setBRegion(e.target.value)}
              disabled={sameAsHome}
            />
            <input
              className="input"
              placeholder="Postal code"
              value={bPost}
              onChange={(e) => setBPost(e.target.value)}
              disabled={sameAsHome}
            />
          </div>
          <input
            className="input"
            placeholder="Country"
            value={bCountry}
            onChange={(e) => setBCountry(e.target.value)}
            disabled={sameAsHome}
          />
        </section>

        {/* Card form (dummy for now) */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Card</h2>
          <input className="input" placeholder="Card number" value={card} onChange={(e) => setCard(e.target.value)} />
          <input
            className="input"
            placeholder="Name on card"
            value={nameOnCard}
            onChange={(e) => setNameOnCard(e.target.value)}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" placeholder="Expiry (MM/YY)" value={exp} onChange={(e) => setExp(e.target.value)} />
            <input className="input" placeholder="CVC" value={cvc} onChange={(e) => setCvc(e.target.value)} />
          </div>
        </section>

        {err && <div className="text-red-600">{err}</div>}

        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-xl border px-4 py-2"
            type="button"
          >
            Back
          </button>
          <button
            onClick={handlePayNow}
            disabled={submitting}
            className="rounded-xl bg-black px-5 py-2 text-white disabled:opacity-60"
            type="button"
          >
            {submitting ? "Processing…" : "Pay now"}
          </button>
        </div>
      </div>

      {/* tiny util styles */}
      <style jsx global>{`
        .input {
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          padding: 0.6rem 0.9rem;
          width: 100%;
        }
        .drop-shadow {
          filter: drop-shadow(0 1px 1px rgba(0,0,0,.15));
          border-radius: .5rem;
        }
      `}</style>
    </div>
  );
}
