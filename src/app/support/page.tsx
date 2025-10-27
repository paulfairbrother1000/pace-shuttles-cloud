// src/app/support/page.tsx
import React from "react";
import nextDynamic from "next/dynamic"; // ← renamed to avoid clashing with export const dynamic
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

export const dynamic = "force-dynamic"; // route option (ok now, no name clash)

// Client-only components so SSR never executes browser code
const ChatPanelWrapper = nextDynamic(
  () =>
    import("@/components/support/ChatPanelWrapper").then(
      (m) => m.default ?? m.ChatPanelWrapper
    ),
  { ssr: false }
);

const TicketListWrapper = nextDynamic(
  () =>
    import("@/components/support/TicketListWrapper").then(
      (m) => m.default ?? m.TicketListWrapper
    ),
  { ssr: false }
);

const CreateTicketForm = nextDynamic(
  () =>
    import("@/components/support/CreateTicketForm").then(
      (m) => m.default ?? m.CreateTicketForm
    ),
  { ssr: false }
);

export default async function Page() {
  // 🔑 Import the Supabase helper lazily to avoid module-init side effects
  const { getSupabaseServerSafe } = await import("@/lib/supabaseServerSafe");

  // Resolve session safely; never throw during SSR
  let user: { id: string; email?: string | null } | null = null;
  try {
    const sb = getSupabaseServerSafe();
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

  // No server fetch here; TicketListWrapper can fetch client-side
  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Support</h1>
          <a className="text-sm text-blue-300 underline" href="#create">New ticket</a>
        </div>

        <ChatPanelWrapper mode="signed" />
        <TicketListWrapper title="My tickets" tickets={[]} />

        <Card id="create">
          <CardHeader><h3 className="font-semibold">Create a ticket</h3></CardHeader>
          <CardContent><CreateTicketForm /></CardContent>
        </Card>
      </div>
    </main>
  );
}
