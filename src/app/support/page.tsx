// src/app/support/page.tsx
import React from "react";
import { headers } from "next/headers";
import dynamic from "next/dynamic";

// Keep YOUR repo’s casing for shared UI.
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

// Load these strictly on the client so SSR never executes their code.
const ChatPanelWrapper = dynamic(
  () => import("@/components/support/ChatPanelWrapper"),
  { ssr: false }
);
const TicketListWrapper = dynamic(
  () => import("@/components/support/TicketListWrapper"),
  { ssr: false }
);
const CreateTicketForm = dynamic(
  () => import("@/components/support/CreateTicketForm"),
  { ssr: false }
);

import { getSupabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic"; // respect cookies; do not cache

async function fetchTicketsSafe(): Promise<any[]> {
  try {
    const h = headers();
    const proto = h.get("x-forwarded-proto") || "https";
    const host = h.get("x-forwarded-host") || h.get("host") || "";
    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
      (host ? `${proto}://${host}` : "");
    const url = `${base}/api/tickets/list`;

    const res = await fetch(url, { cache: "no-store", next: { revalidate: 0 } });
    if (!res.ok) return [];
    return (await res.json()) ?? [];
  } catch (err) {
    console.error("tickets/list fetch failed", err);
    return [];
  }
}

export default async function Page() {
  // Resolve session safely; never throw during SSR
  let user: { id: string; email?: string | null } | null = null;
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user) {
      user = { id: data.user.id, email: data.user.email ?? null };
    }
  } catch (err) {
    console.error("getUser failed", err);
    user = null;
  }

  // Signed-out view
  if (!user) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff] p-6">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardContent>
              <p className="text-sm">
                Please{" "}
                <a className="text-blue-400 underline" href="/login">
                  sign in
                </a>{" "}
                to view and create support tickets.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  // Signed-in view
  const tickets = await fetchTicketsSafe();

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Support</h1>
          <a className="text-sm text-blue-300 underline" href="#create">
            New ticket
          </a>
        </div>

        {/* Client-only chat */}
        <ChatPanelWrapper mode="signed" />

        {/* Tickets list */}
        <TicketListWrapper title="My tickets" tickets={tickets as any[]} />

        {/* Create ticket */}
        <Card id="create">
          <CardHeader>
            <h3 className="font-semibold">Create a ticket</h3>
          </CardHeader>
          <CardContent>
            <CreateTicketForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
