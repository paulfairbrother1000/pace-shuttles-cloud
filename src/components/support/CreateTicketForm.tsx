"use client";

import React from "react";
import { Button } from "@/components/ui/Button";

export default function CreateTicketForm() {
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
        setSubject(""); setBody(""); setBookingRef("");
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
        <Button onClick={submit} disabled={busy} className="bg-[#2a6cd6] text-white hover:opacity-90">
          {busy ? "Submitting…" : "Submit"}
        </Button>
        {ok && <span className="text-sm text-[#a3b3cc]">{ok}</span>}
      </div>
    </div>
  );
}
