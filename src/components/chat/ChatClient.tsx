"use client";

import * as React from "react";

type Turn = { role: "user" | "assistant"; content: string };

export default function ChatClient() {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setTurns(t => [...t, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const data = await res.json();
      const content = String(data?.content ?? "Sorry, I didn’t catch that.");
      setTurns(t => [...t, { role: "assistant", content }]);
    } catch {
      setTurns(t => [
        ...t,
        {
          role: "assistant",
          content:
            "I couldn’t reach the agent right now. Please try again or email hello@paceshuttles.com.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="rounded-xl border border-neutral-300 bg-white text-neutral-900">
      <div className="max-h-[50vh] overflow-y-auto p-4 space-y-3">
        {turns.length === 0 ? (
          <p className="opacity-75">
            Ask me about destinations, pricing rules, cancellation policy, or how Pace Shuttles works.
          </p>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
              <div
                className={
                  "inline-block rounded-xl px-3 py-2 " +
                  (t.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-100 text-neutral-900 border border-neutral-200")
                }
              >
                {t.content}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 p-3 border-t border-neutral-200 bg-neutral-50">
        <input
          className="flex-1 rounded-lg bg-white text-black placeholder-neutral-500 border border-neutral-300 px-3 py-2 outline-none"
          placeholder="Type your question…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        <button
          className="rounded-lg px-3 py-2 bg-blue-600 text-white disabled:opacity-50"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
