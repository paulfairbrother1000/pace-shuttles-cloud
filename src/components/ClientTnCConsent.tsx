"use client";
import { useState } from "react";

type Props = {
  quoteToken: string;
  tncVersion: string;
  onConsented: () => void;
};

/**
 * Renders a checkbox + "I agree" action to persist consent for the given quoteToken/tncVersion.
 * On success, calls onConsented() so the caller can enable the proceed button.
 */
export default function ClientTnCConsent({ quoteToken, tncVersion, onConsented }: Props) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consent/client-tnc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteToken, tncVersion }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to record consent (${res.status})`);
      }
      onConsented();
    } catch (e: any) {
      setError(e.message || "Something went wrong saving your consent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          aria-describedby="tnc-help"
        />
        <span className="text-sm leading-6">
          I confirm I’ve <strong>read and understood</strong>{" "}
          <a
            href="/legal/client-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            the Client Terms &amp; Conditions
          </a>{" "}
          and agree to be bound by them.
          <div id="tnc-help" className="text-xs text-neutral-600 mt-1">
            No cancellations. Reschedule up to <strong>T-72</strong> (subject to availability) within{" "}
            <strong>12 months</strong> of your original date.
          </div>
        </span>
      </label>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none underline">Quick preview of key points</summary>
        <ul className="mt-2 list-disc pl-5 text-neutral-700">
          <li>Pace Shuttles acts as an intermediary/booking platform (not the carrier).</li>
          <li>Travel is under the operator’s insurance; follow crew instructions at all times.</li>
          <li>No cancellations; rescheduling allowed up to T-72 within 12 months, subject to availability.</li>
          <li>We don’t store card details; payments are via an external provider.</li>
          <li>Only manifest data is shared with operators/destinations.</li>
        </ul>
        <p className="mt-2 text-xs text-neutral-500">
          This is a summary. Please read the full{" "}
          <a href="/legal/client-terms" target="_blank" rel="noopener noreferrer" className="underline">
            Client Terms &amp; Conditions
          </a>.
        </p>
      </details>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!checked || saving}
          className={`px-4 py-2 rounded-xl border text-sm ${!checked || saving ? "opacity-50 cursor-not-allowed" : ""}`}
          aria-disabled={!checked || saving}
        >
          {saving ? "Saving…" : "I agree"}
        </button>
      </div>
    </div>
  );
}
