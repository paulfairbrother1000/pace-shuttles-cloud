// src/app/support/page.tsx
import React from "react";
import { headers } from "next/headers";

// ✅ shadcn/ui imports must be lower-case file paths
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import TicketListWrapper from "@/components/support/TicketListWrapper";
import { getSupabaseServer } from "@/lib/supabaseServer";
import ChatPanelWrapper from "@/components/support/ChatPanelWrapper";

export const dynamic = "force-dynamic"; // don't cache, always respect cookies

async function fetchTicketsSafe(): Promise<any[]> {
  try {
    // Build an absolute URL for server-side fetch (works on Vercel)
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
  } catch {
    return [];
  }
}

export default async function Page() {
  // ---- Resolve session safely
  let user: { id: string; email?: string | null } | null = null;
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user) {
      user = { id: data.user.id, email: data.user.email ?? null };
    }
  } catch {
    // treat as signed-out if anything goes wrong resolving session
    user = null;
  }

  // ---- Signed-out view
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

  // ---- Signed-in view
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
        <CreateTicket />
      </div>
    </main>
  );
}

function CreateTicket() {
  return (
    <Card id="create">
      <CardHeader>
        <h3 className="font-semibold">Create a ticket</h3>
      </CardHeader>
      <CardContent>
        <CreateTicketForm />
      </CardContent>
    </Card>
  );
}

// Inline client subform (kept as before)
function CreateTicketForm() {
  "use client";
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [bookingRef, setBookingRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setOk(null);
    try {
      const res = await fetch("/api/tickets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userText: body, bookingRef, subject }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOk(`Created #${data.ticketId}`);
        setSubject("");
        setBody("");
        setBookingRef("");
      } else {
        setOk(data.error || "Failed");
      }
    } catch {
      setOk("Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <input
        className="border rounded-xl px-3 py-2 text-sm bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_8%)] text-[#eaf2ff] border-[color-mix(in_oklab,_#0f1a2a_70%,_white_12%)]"
        placeholder="Subject (optional)"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="border rounded-xl px-3 py-2 text-sm min-h-[120px] bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_8%)] text-[#eaf2ff] border-[color-mix(in_oklab,_#0f1a2a_70%,_white_12%)]"
        placeholder="Describe the issue or request"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <input
        className="border rounded-xl px-3 py-2 text-sm bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_8%)] text-[#eaf2ff] border-[color-mix(in_oklab,_#0f1a2a_70%,_white_12%)]"
        placeholder="Booking reference (optional)"
        value={bookingRef}
        onChange={(e) => setBookingRef(e.target.value)}
      />
      <div className="flex gap-2 items-center">
        <Button
          onClick={submit}
          className="bg-[#2a6cd6] text-white border-[#2a6cd6] hover:bg-[#2a6cd6]/90"
        >
          {busy ? "Submitting…" : "Submit"}
        </Button>
        {ok && <span className="text-sm text-[#a3b3cc]">{ok}</span>}
      </div>
    </div>
  );
}
