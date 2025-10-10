// src/app/book/pay/page.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import ClientTnCConsent from "@/components/ClientTnCConsent";

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

type Guest = { first_name: string; last_name: string };

// Browser-only Supabase client
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

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

  // consent + UI state
  const [consented, setConsented] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Keep client/server versions aligned. Client can also fall back safely.
  const tncVersion = process.env.NEXT_PUBLIC_CLIENT_TNC_VERSION ?? "2025-10-10";

  // Prefill from Supabase: users.first_name, users.last_name, users.mobile; email from auth
  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!sb) return;

        // 1) Auth session
        const { data: auth } = await sb.auth.getUser();
        const authedEmail = auth?.user?.email || "";
        const authedId = auth?.user?.id || "";

        // Email: prefer auth email (authoritative)
        if (!off && authedEmail && !leadEmail) setLeadEmail(authedEmail);

        // 2) Try users.auth_user_id first (ideal case)
        let first: string | null = null;
        let last: string | null = null;
        let phone: string | null = null;

        if (authedId) {
          const { data: byAuthId } = await sb
            .from("users")
            .select("first_name,last_name,mobile")
            .eq("auth_user_id", authedId)
            .maybeSingle();

          if (byAuthId) {
            first = (byAuthId.first_name ?? null) as any;
            last  = (byAuthId.last_name  ?? null) as any;
            phone = byAuthId.mobile != null ? String(byAuthId.mobile) : null;
          }
        }

        // 3) Fallback: match by email
        if ((!first || !last || !phone) && authedEmail) {
          const { data: byEmail } = await sb
            .from("users")
            .select("first_name,last_name,mobile")
            .ilike("email", authedEmail)
            .maybeSingle();

          if (byEmail) {
            if (!first) first = (byEmail.first_name ?? null) as any;
            if (!last)  last  = (byEmail.last_name  ?? null) as any;
            if (!phone) phone = byEmail.mobile != null ? String(byEmail.mobile) : null;
          }
        }

        // 4) Final fallback: auth user_metadata
        if (!first || !last) {
          const meta = (auth?.user?.user_metadata ?? {}) as Record<string, any>;
          const fullName: string | undefined =
            meta.full_name || meta.name || meta["fullName"] || meta["given_name"];
          if (fullName && (!first || !last)) {
            const parts = String(fullName).trim().split(/\s+/);
            if (parts.length >= 2) {
              if (!first) first = parts[0];
              if (!last)  last  = parts.slice(1).join(" ");
            } else if (parts.length === 1 && !first) {
              first = parts[0];
            }
          }
          if (!first && meta.first_name) first = String(meta.first_name);
          if (!last  && meta.last_name)  last  = String(meta.last_name);
        }

        if (!off) {
          if (first && !leadFirst) setLeadFirst(first);
          if (last  && !leadLast)  setLeadLast(last);
          if (phone && !leadPhone) setLeadPhone(phone);
        }
      } catch {
        // ignore prefill errors
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateGuest(i: number, patch: Partial<Guest>) {
    setGuests((prev) => {
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  /* ---------------- Background email trigger (non-blocking) ---------------- */
  function notifyBookingEmail(params: {
    lead_first_name: string;
    lead_last_name: string;
    lead_email: string;
    lead_phone: string;
  }) {
    try {
      const payload = {
        qid,
        routeId,
        date: dateISO,
        qty,
        token,
        perSeatAllIn: allInC,
        currency: ccy,
        total,
        ...params,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });

      const ok =
        typeof navigator !== "undefined" && "sendBeacon" in navigator
          ? navigator.sendBeacon("/api/email/booking-request", blob)
          : false;

      if (!ok) {
        fetch("/api/email/booking-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore email errors */
    }
  }

  /* ------------------------------- Submit ---------------------------------- */
  async function handlePayNow() {
    setErr(null);

    // Required quote bits (server will also verify)
    if (!routeId || !dateISO || !qty || !token || !Number.isFinite(allInC)) {
      setErr("Missing route/date/qty/token/price");
      return;
    }

    // Lead required: name + email + phone
    if (!leadFirst.trim() || !leadLast.trim()) {
      setErr("Lead passenger first/last name required.");
      return;
    }
    if (!leadEmail.trim()) {
      setErr("Lead passenger email is required.");
      return;
    }
    if (!leadPhone.trim()) {
      setErr("Lead passenger phone is required.");
      return;
    }
    const emailOk = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(leadEmail.trim());
    if (!emailOk) {
      setErr("Please enter a valid email address.");
      return;
    }
    if (leadPhone.trim().replace(/[^\\d+]/g, "").length < 6) {
      setErr("Please enter a valid phone number.");
      return;
    }

    // All guest names required
    for (let i = 0; i < guests.length; i++) {
      if (!guests[i].first_name.trim() || !guests[i].last_name.trim()) {
        setErr(\`Guest \${i + 1} needs first and last name.\`);
        return;
      }
    }

    // Build passengers (exactly one lead)
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

    if (!consented) {
      setErr("You must confirm you have read and understood the Client Terms & Conditions before continuing.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Quote contract
          qid,
          routeId,
          date: dateISO,
          qty,
          token,   // signed quote token
          allInC,  // per-seat all-in (GBP units)
          ccy,

          // Lead contact
          lead_first_name: leadFirst.trim(),
          lead_last_name: leadLast.trim(),
          lead_email: leadEmail.trim(),
          lead_phone: leadPhone.trim(),

          // Manifest
          passengers, // [{ first_name, last_name, is_lead }]
        }),
      });

      // Not logged in → bounce to login and return here
      if (res.status === 401) {
        const returnTo =
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : "/book/pay";
        router.replace(`/login?next=${encodeURIComponent(returnTo)}`);
        return;
      }

      const json = await res.json().catch(() => ({} as any));

      // If server still says consent missing, show a clear banner
      if (res.status === 400 && json?.help?.code === "CONSENT_REQUIRED") {
        setErr("You must confirm you have read and understood the Client Terms & Conditions before continuing.");
        setSubmitting(false);
        return;
      }

      if (!res.ok || !json?.ok || !json?.url) {
        throw new Error(json?.error || "Payment failed.");
      }

      // Fire-and-forget booking email
      notifyBookingEmail({
        lead_first_name: leadFirst.trim(),
        lead_last_name: leadLast.trim(),
        lead_email: leadEmail.trim(),
        lead_phone: leadPhone.trim(),
      });

      // Server supplies canonical success URL
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
            placeholder="First name *"
            value={leadFirst}
            onChange={(e) => setLeadFirst(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Last name *"
            value={leadLast}
            onChange={(e) => setLeadLast(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="input"
            type="email"
            placeholder="Email *"
            value={leadEmail}
            onChange={(e) => setLeadEmail(e.target.value)}
            required
          />
          <input
            className="input"
            placeholder="Phone *"
            value={leadPhone}
            onChange={(e) => setLeadPhone(e.target.value)}
            required
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

      {/* ---- Client Terms & Conditions consent (required) ---- */}
      <div id="client-tnc-consent" className="rounded-2xl border p-4">
        <ClientTnCConsent
          quoteToken={token}
          tncVersion={tncVersion}
          onConsented={() => setConsented(true)}
        />
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{err}</div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handlePayNow} disabled={!consented || submitting} className="btn-primary" type="button">
          {submitting ? "Processing…" : "Proceed to payment"}
        </button>
        <button onClick={() => router.back()} disabled={submitting} className="btn-secondary" type="button">
          Back
        </button>
      </div>

      <p className="text-xs text-gray-500">
        By continuing, you agree to our terms. You can{" "}
        <a href="/legal/client-terms" target="_blank" rel="noopener noreferrer" className="underline">
          read the Client Terms &amp; Conditions here
        </a>.
      </p>

      <style jsx global>{`
        .input { border:1px solid #e5e7eb; border-radius:.75rem; padding:.6rem .9rem; width:100%; }
        .btn-primary { border-radius: .75rem; background:#000; color:#fff; padding:.5rem 1rem; font-size:.9rem; }
        .btn-primary[disabled] { opacity:.5; cursor:not-allowed; }
        .btn-secondary { border-radius: .75rem; border:1px solid #e5e7eb; padding:.5rem 1rem; font-size:.9rem; }
      `}</style>
    </div>
  );
}
