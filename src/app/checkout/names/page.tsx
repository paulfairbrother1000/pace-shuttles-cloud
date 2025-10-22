// src/app/checkout/names/page.tsx
"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClientTnCConsent from "@/components/ClientTnCConsent";
import { submitCheckout } from "@/utils/checkout";

/** Inner client component that uses useSearchParams */
function NamesInner(): JSX.Element {
  const searchParams = useSearchParams();

  // Prefer URL (?quoteToken=... or ?token=...) then sessionStorage fallback
  const quoteToken = useMemo(() => {
    const fromUrl = searchParams.get("quoteToken") || searchParams.get("token");
    if (fromUrl) return fromUrl;
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("quoteToken") ?? "";
    }
    return "";
  }, [searchParams]);

  const tncVersion = process.env.NEXT_PUBLIC_CLIENT_TNC_VERSION ?? "2025-10-10";

  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // TODO: Replace with your actual form state
  const payload = {
    token: quoteToken,
    routeId: "...",
    date: "...",
    qty: 2,
    ccy: "GBP",
    passengers: [
      { first_name: "Alex", last_name: "Fairbrother", is_lead: true },
      { first_name: "Sam", last_name: "Guest" },
    ],
    lead_first_name: "Alex",
    lead_last_name: "Fairbrother",
    lead_email: "alex@example.com",
    lead_phone: "+1 555 123 4567",
    perSeatAllIn: 120,
  };

  async function onContinue() {
    if (!consented || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await submitCheckout(payload);
      if (!res.ok) {
        setErr(res?.error || "Checkout failed.");
        return;
      }
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e: any) {
      setErr(e?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Passenger details</h1>

      {/* TODO: your passenger form fields here */}

      {/* Client T&C consent (link opens /legal/client-terms in a new tab) */}
      <div id="client-tnc-consent" className="mt-8">
        <ClientTnCConsent
          quoteToken={quoteToken}
          tncVersion={tncVersion}
          onConsented={() => setConsented(true)}
        />
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!consented || submitting}
          className={`px-5 py-2 rounded-xl bg-black text-white text-sm ${
            !consented || submitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          aria-disabled={!consented || submitting}
        >
          {submitting ? "Please wait…" : "Proceed to payment"}
        </button>
      </div>
    </div>
  );
}

/** Page export with Suspense boundary to satisfy Next.js CSR bailout rules */
export default function NamesPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl p-6">
          <div className="rounded-2xl border p-4 bg-white">Loading…</div>
        </div>
      }
    >
      <NamesInner />
    </Suspense>
  );
}
