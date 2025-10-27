// -----------------------------------------------------------------------------
// src/components/support/TicketList.tsx
// -----------------------------------------------------------------------------


import React from "react";
import { Card, CardContent, CardHeader } from "../ui/Card";


type Ticket = {
id: number;
subject: string;
status: string;
updated_at: string;
// SLA badges (operator pages)
resp_badge?: "on_time"|"due_soon"|"breached";
resp_due_in_mins?: number | null;
sol_badge?: "on_time"|"due_soon"|"breached";
sol_due_in_mins?: number | null;
};


function Badge({ kind }: { kind?: "on_time"|"due_soon"|"breached" }) {
const map: Record<string, string> = {
on_time: "bg-green-100 text-green-800",
due_soon: "bg-amber-100 text-amber-800",
breached: "bg-red-100 text-red-800",
};
if (!kind) return null;
return <span className={`px-2 py-0.5 rounded-full text-xs ${map[kind]}`}>{kind.replace("_"," ")}</span>;
}


export function TicketList({ title, tickets }: { title: string; tickets: Ticket[] }) {
return (
<Card className="w-full">
<CardHeader><h3 className="font-semibold">{title}</h3></CardHeader>
<CardContent>
{tickets.length === 0 ? (
<div className="text-sm text-gray-500">No tickets yet.</div>
) : (
<ul className="divide-y divide-gray-100">
{tickets.map(t => (
<li key={t.id} className="py-3 flex items-start justify-between gap-4">
<div>
<div className="font-medium text-sm">#{t.id} — {t.subject}</div>
<div className="text-xs text-gray-500">Updated {new Date(t.updated_at).toLocaleString()}</div>
</div>
<div className="flex items-center gap-2">
<span className="px-2 py-0.5 rounded-full text-xs bg-gray-100">{t.status}</span>
{t.resp_badge && <Badge kind={t.resp_badge} />}
{t.sol_badge && <Badge kind={t.sol_badge} />}
</div>
</li>
))}
</ul>
)}
</CardContent>
</Card>
);
}