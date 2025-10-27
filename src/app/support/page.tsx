// src/app/support/page.tsx

import React from "react";
import { Card, CardContent, CardHeader, Button } from "@/components/ui/Card";
import { TicketList } from "@/components/support/TicketList";
import { getSupabaseServer } from "@/lib/supabaseServer";
import ChatPanelWrapper from "@/components/support/ChatPanelWrapper";

async function fetchTickets() {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
    const res = await fetch(`${base}/api/tickets/list`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export default async function Page() {
  const sb = getSupabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

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

  const tickets = await fetchTickets();

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff] p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Support</h1>
          <a className="text-sm text-blue-300 underline" href="#create">
            New ticket
          </a>
        </div>

        {/* Chat panel (client-only via wrapper) */}
        <ChatPanelWrapper mode="signed" />

        {/* Tickets list */}
        <TicketList title="My tickets" tickets={tickets as any[]} />

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

// Inline client subform
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
