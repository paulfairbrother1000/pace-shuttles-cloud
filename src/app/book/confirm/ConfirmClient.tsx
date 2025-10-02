// src/app/book/confirm/ConfirmClient.tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

const fmt = (n: number, cur = "GBP") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(n);

export default function ConfirmClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const routeId = sp.get("routeId") || "";
  const dateISO = sp.get("date") || "";
  const qtyRaw = sp.get("qty") || "1";
  const qtyParsed = Number.parseInt(qtyRaw, 10);
  const qty = Number.isFinite(qtyParsed) ? Math.max(1, qtyParsed) : 1;

  // **exact SSOT from list page**
  const token = sp.get("token") || "";
  const allInCParsed = Number(sp.get("allInC"));
  const allInC = Number.isFinite(allInCParsed) ? allInCParsed : NaN;
  const valid = Boolean(token) && Number.isFinite(allInC) && allInC > 0;

  function next() {
    const u = new URL("/book/pay", window.location.origin);
    u.searchParams.set("routeId", routeId);
    u.searchParams.set("date", dateISO);
    u.searchParams.set("qty", String(qty));
    u.searchParams.set("token", token);
    u.searchParams.set("allInC", String(allInC));
    router.push(u.pathname + "?" + u.searchParams.toString());
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <h1 className="text-3xl font-semibold">Order confirmation</h1>

      <section className="rounded-2xl border bg-white p-5 shadow space-y-2">
        <div className="text-lg font-medium">Tickets: {qty}</div>
        <div className="text-neutral-700">
          Per ticket <em>(incl. tax &amp; fees)</em>:{" "}
          <strong>{valid ? fmt(allInC) : "—"}</strong>
        </div>
        <div className="flex items-center justify-between text-lg font-medium">
          <span>Total:</span>
          <span>{valid ? fmt(allInC * qty) : "—"}</span>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow">
        <button
          className="rounded bg-neutral-900 text-white px-5 py-3 disabled:opacity-60"
          onClick={next}
          disabled={!valid}
        >
          Proceed to payment
        </button>
      </section>
    </div>
  );
}
