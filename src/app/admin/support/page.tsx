import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

async function fetchAll() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/tickets/summary`, { cache: "no-store" });
  if (!res.ok) return { operators: [] };
  return await res.json();
}

export default async function Page() {
  const data = await fetchAll();
  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold">Pace Support — Admin</h1>
        <Card>
          <CardHeader><h3 className="font-semibold">Operators</h3></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Operator Group</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Open</th>
                    <th className="py-2 pr-4">New</th>
                    <th className="py-2 pr-4">Resp DueSoon/Breached</th>
                    <th className="py-2 pr-4">ETA DueSoon/Breached</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.operators ?? []).map((op: any, idx: number) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="py-2 pr-4">{op.group_name}</td>
                      <td className="py-2 pr-4">{op.total}</td>
                      <td className="py-2 pr-4">{op.totals?.open ?? 0}</td>
                      <td className="py-2 pr-4">{op.totals?.new ?? 0}</td>
                      <td className="py-2 pr-4">{(op.responseSLA?.dueSoon ?? 0)}/{(op.responseSLA?.breached ?? 0)}</td>
                      <td className="py-2 pr-4">{(op.solutionSLA?.dueSoon ?? 0)}/{(op.solutionSLA?.breached ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
