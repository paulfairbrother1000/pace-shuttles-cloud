// src/app/checkout/names/page.tsx  (example)
"use client";

import { useState } from "react";
import ClientTnCConsent from "@/components/ClientTnCConsent";
import { submitCheckout } from "@/utils/checkout";

export default function NamesPage() {
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const quoteToken =
    typeof window !== "undefined" ? sessionStorage.getItem("quoteToken") ?? "" : "";
  const tncVersion = process.env.NEXT_PUBLIC_CLIENT_TNC_VERSION ?? "2025-10-10";

  // Build payload from your form state
  const payload = {
    token: quoteToken,
    routeId: "...",
    date: "...",
    qty: 2,
    ccy: "GBP",
    passengers: [
      { first_name: "Alex", last_name: "Fairbrother", is_lead: true },
      { first_name: "Sam", last_name: "Guest" }
    ],
    lead_first_name: "Alex",
    lead_last_name: "Fairbrother",
    lead_email: "alex@example.com",
    lead_phone: "+1 555 123 4567",
    perSeatAllIn: 120
  };

  async function onContinue() {
    if (!consented || submitting) return;
    setSubmitting(true);
    const res = await submitCheckout(payload);
    setSubmitting(false);
    if (!res.ok) return; // If consent missing, the helper already scrolled + alerted
    window.location.href = res.data.url; // success redirect from API
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Passenger details</h1>

      {/* your passenger form fields here */}

      <div id="client-tnc-consent">
        <ClientTnCConsent
          quoteToken={quoteToken}
          tncVersion={tncVersion}
          onConsented={() => setConsented(true)}
        />
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!consented || submitting}
          className={`px-5 py-2 rounded-xl bg-black text-white text-sm ${!consented || submitting ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {submitting ? "Please wait…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
