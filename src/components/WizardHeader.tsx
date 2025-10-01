"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Step = 1 | 2 | 3 | 4 | 5;

type Props = {
  step: Step;
  title?: string;
};

export default function WizardHeader({ step, title }: Props) {
  const sp = useSearchParams();
  const country_id = sp.get("country_id") || "";
  const journey_type_id = sp.get("journey_type_id") || "";
  const destination_id = sp.get("destination_id") || "";
  const pickup_id = sp.get("pickupId") || "";
  const route_id = sp.get("routeId") || "";
  const date = sp.get("date") || "";

  const hrefCountry = `/book/country`;
  const hrefType = country_id ? `/book/type?country_id=${country_id}` : `/book/type`;
  const hrefDestination = (() => {
    if (!country_id) return `/book/destination`;
    const qp = new URLSearchParams({ country_id });
    if (journey_type_id) qp.set("journey_type_id", journey_type_id);
    return `/book/destination?${qp.toString()}`;
  })();
  const hrefDate = (() => {
    if (!country_id || !destination_id) return `/book/date`;
    const qp = new URLSearchParams({ country_id, destination_id });
    if (journey_type_id) qp.set("journey_type_id", journey_type_id);
    if (pickup_id) qp.set("pickupId", pickup_id);
    return `/book/date?${qp.toString()}`;
  })();
  const hrefDetails = (() => {
    if (!route_id || !date) return `/book/details`;
    const qp = new URLSearchParams({
      routeId: route_id,
      date,
      pickupId: pickup_id,
      destinationId: destination_id,
      country_id,
    });
    if (journey_type_id) qp.set("journey_type_id", journey_type_id);
    return `/book/details?${qp.toString()}`;
  })();

  const steps = [
    { id: 1, label: "Country", href: hrefCountry, active: step >= 1 },
    { id: 2, label: "Transport", href: hrefType, active: step >= 2 },
    { id: 3, label: "Destination", href: hrefDestination, active: step >= 3 },
    { id: 4, label: "Date", href: hrefDate, active: step >= 4 },
    { id: 5, label: "Details", href: hrefDetails, active: step >= 5 },
  ];

  const defaultTitles: Record<Step, string> = {
    1: "Choose country",
    2: "Choose transport type",
    3: "Choose destination",
    4: "Choose a date",
    5: "Journey details",
  };

  return (
    <header className="space-y-3">
      <nav aria-label="Breadcrumb" className="rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
        <ol className="flex items-center gap-2 text-sm">
          {steps.map((s, idx) => {
            const isCurrent = s.id === step;
            const base = "rounded-lg px-2.5 py-1.5 transition whitespace-nowrap";
            const activeClass = isCurrent
              ? "bg-neutral-900 text-white"
              : s.active
              ? "bg-neutral-100 text-neutral-800 hover:bg-neutral-200"
              : "bg-neutral-50 text-neutral-400 cursor-not-allowed";

            const canClickBack =
              s.id < step && (
                (s.id === 2 && country_id) ||
                (s.id === 3 && country_id) ||
                (s.id === 4 && country_id && destination_id) ||
                (s.id === 5 && route_id && date)
              );

            const chip = <span className={`${base} ${activeClass}`} key={s.id}>{s.label}</span>;

            return (
              <React.Fragment key={s.id}>
                {canClickBack ? <Link href={s.href} className="no-underline">{chip}</Link> : chip}
                {idx < steps.length - 1 && <span className="text-neutral-300">›</span>}
              </React.Fragment>
            );
          })}
        </ol>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title ?? defaultTitles[step]}</h1>
        <span className="text-sm text-neutral-600">Step {step} of 5</span>
      </div>
    </header>
  );
}
