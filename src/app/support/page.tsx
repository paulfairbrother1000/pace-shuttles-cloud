import React from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { getSupabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic"; // always respect cookies

// Client-only components so SSR never executes browser code
const ChatPanelWrapper = dynamic(() => import("@/components/support/ChatPanelWrapper"), { ssr: false });
const TicketListWrapper = dynamic(() => import("@/components/support/TicketListWrapper"), { ssr: false });
const CreateTicketForm = dynamic(() => import("@/components/support/CreateTicketForm"), { ssr: false });

export default async function Page() {
  // Resolve session safely; never throw during SSR
  let user: { id: string; email?: string | null } | null = null;
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user) user = { id: data.user.id, email: data.user.email ?? null };
  } catch {
    user = null;
  }

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

  // No server fetch here; TicketListWrapper can fetch on the client if needed
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

        {/* Tickets list (let this component fetch client-side) */}
        <TicketListWrapper title="My tickets" tickets={[]} />

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
