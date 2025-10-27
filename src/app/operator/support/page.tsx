// -----------------------------------------------------------------------------
// src/app/operator/support/page.tsx (Operator Admin)
// -----------------------------------------------------------------------------


import React from "react";
import { SummaryTiles } from "@/src/components/support/SummaryTiles";
import { TicketList } from "@/src/components/support/TicketList";
import { Card, CardContent } from "@/src/components/ui/Card";


async function fetchOperator(operatorId: string) {
const [summaryRes, listRes] = await Promise.all([
fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/tickets/operator/summary?operatorId=${operatorId}`, { cache: "no-store" }),
fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/tickets/operator/list?operatorId=${operatorId}&state=open`, { cache: "no-store" }),
]);
const summary = summaryRes.ok ? await summaryRes.json() : null;
const list = listRes.ok ? await listRes.json() : { tickets: [] };
return { summary, list };
}


export default async function Page() {
// TODO: resolve the current operatorId server-side from the signed-in operator profile
const operatorId = "00000000-0000-0000-0000-000000000001";
const { summary, list } = await fetchOperator(operatorId);
return (
<main className="p-4 md:p-6">
<div className="mx-auto max-w-6xl space-y-6">
<div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Operator Support</h1></div>
<SummaryTiles data={summary} />
<TicketList title={`Tickets — ${summary?.group ?? "Group"}`} tickets={list?.tickets ?? []} />
{!summary && <Card><CardContent><p className="text-sm text-gray-600">No access or no mapping found for this operator.</p></CardContent></Card>}
</div>
</main>
);
}