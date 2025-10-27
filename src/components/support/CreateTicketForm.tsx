"use client";
import React from "react";
import { Button } from "@/components/ui/Button"; // ✅ client-only button

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
      {/* inputs... */}
      <div className="flex gap-2 items-center">
        <Button onClick={submit} disabled={busy} className="bg-[#2a6cd6] text-white hover:opacity-90">
          {busy ? "Submitting…" : "Submit"}
        </Button>
        {ok && <span className="text-sm text-[#a3b3cc]">{ok}</span>}
      </div>
    </div>
  );
}
