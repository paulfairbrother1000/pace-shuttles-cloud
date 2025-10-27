// -----------------------------------------------------------------------------
// src/components/support/SummaryTiles.tsx
// -----------------------------------------------------------------------------


import React from "react";


export function SummaryTiles({ data }: { data: any }) {
// For operator summary: { totals, total, responseSLA: {breached, dueSoon}, solutionSLA: {...} }
const items = [
{ label: "Open", value: data?.totals?.open ?? 0 },
{ label: "New", value: data?.totals?.new ?? 0 },
{ label: "Escalations (Resp)", value: (data?.responseSLA?.breached ?? 0) + (data?.responseSLA?.dueSoon ?? 0) },
{ label: "Escalations (ETA)", value: (data?.solutionSLA?.breached ?? 0) + (data?.solutionSLA?.dueSoon ?? 0) },
];
return (
<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
{items.map((it, i) => (
<div key={i} className="rounded-2xl border border-gray-200 bg-white p-3">
<div className="text-xs text-gray-500">{it.label}</div>
<div className="text-xl font-semibold">{it.value}</div>
</div>
))}
</div>
);
}