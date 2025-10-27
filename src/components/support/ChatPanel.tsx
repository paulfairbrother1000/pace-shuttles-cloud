"use client";

import * as React from "react";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; content: string; at: number };

export default function ChatPanel() {
  const [messages, setMessages] = React.useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hi! I can answer general questions about routes, journeys, and policies. To discuss your bookings, please sign in.",
      at: Date.now(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");

    // render user bubble immediately
    const me: Msg = { role: "user", content: text, at: Date.now() };
    setMessages((m) => [...m, me]);

    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json().catch(() => ({}));
      const assistantText: string =
        // prefer a helpful reply; do NOT repeat the user’s text
        json?.content && typeof json.content === "string"
          ? json.content
          : "Thanks! I can help with routes, pickup points, booking policies and using the Pace app. If your question is about your bookings or journey history, please sign in first.";

      setMessages((m) => [
        ...m,
        { role: "assistant", content: assistantText, at: Date.now() },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "Sorry—something went wrong. Please try again, or sign in for booking help.",
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy) void send();
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl shadow-md border border-gray-200 overflow-hidden bg-white">
      {/* Branded header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0f1a2a] text-white">
        <div className="font-semibold">Pace Support</div>
        <Link
          href="/login"
          className="text-xs underline underline-offset-2 hover:opacity-90"
        >
          Sign in for booking help
        </Link>
      </div>

      {/* Transcript */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto bg-[color-mix(in_oklab,_#0f1a2a_3%,_white)]">
        {messages.map((m) => (
          <div
            key={m.at}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                m.role === "user"
                  ? "rounded-full px-3 py-2 text-white bg-[#2a6cd6]"
                  : "rounded-2xl px-3 py-2 text-gray-800 bg-white border border-gray-100"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type your question…"
            className="flex-1 rounded-xl px-3 py-2 border border-gray-300 outline-none focus:border-[#2a6cd6] focus:ring-2 focus:ring-[#2a6cd6]/30"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-xl px-3 py-2 bg-[#2a6cd6] text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
