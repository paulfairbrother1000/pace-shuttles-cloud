// src/components/support/ChatPanel.tsx
"use client";

import * as React from "react";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; content: string; at: number };
type Mode = "anon" | "signed";

function isSignedInFromCache(): boolean {
  try {
    const raw = localStorage.getItem("ps_user");
    if (!raw) return false;
    const u = JSON.parse(raw);
    return !!(u?.id || u?.user_id || u?.email || u?.session || u?.token || u?.role);
  } catch {
    return false;
  }
}

export default function ChatPanel({ mode = "anon" }: { mode?: Mode }) {
  const [signedIn, setSignedIn] = React.useState(false);
  React.useEffect(() => setSignedIn(isSignedInFromCache()), []);

  const [messages, setMessages] = React.useState<Msg[]>([
    {
      role: "assistant",
      // Clean greeting: no policy text
      content: mode === "signed" ? "Hi! How can I help with your Pace Shuttles booking today?" : "Hi! How can I help today?",
      at: Date.now(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");

    // show user bubble immediately
    setMessages((m) => [...m, { role: "user", content: text, at: Date.now() }]);

    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, context: { signedIn } }),
      });
      const json = await res.json().catch(() => ({}));
      const assistantText =
        typeof json?.content === "string" && json.content.trim()
          ? json.content
          : (mode === "signed"
              ? "Thanks! Tell me the journey or booking details you need help with."
              : "Thanks! Ask me about routes, pickup points, countries, or using the app.");

      setMessages((m) => [...m, { role: "assistant", content: assistantText, at: Date.now() }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Sorry—something went wrong. Please try again.", at: Date.now() },
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
    <div
      className="
        w-full max-w-2xl rounded-2xl border
        border-[color-mix(in_oklab,_#0f1a2a_80%,_white_10%)]
        shadow-[0_6px_28px_rgba(0,0,0,0.28)]
        overflow-hidden
        bg-[color-mix(in_oklab,_#0f1a2a_92%,_white_0%)]
        text-[#eaf2ff]
      "
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#0b1626] text-white">
        <div className="font-semibold">Pace Shuttles — Support</div>
        {/* Hide this link for signed-in users */}
        {!signedIn && (
          <Link href="/login" className="text-xs underline underline-offset-2 hover:opacity-90">
            Sign in for booking help
          </Link>
        )}
      </div>

      {/* Transcript */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto bg-[color-mix(in_oklab,_#0f1a2a_96%,_white_0%)]">
        {messages.map((m) => (
          <div key={m.at} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "rounded-2xl px-3 py-2 text-white bg-[#2a6cd6]"
                  : "rounded-2xl px-3 py-2 text-[#eaf2ff] bg-[color-mix(in_oklab,_#0f1a2a_88%,_white_10%)] border border-[color-mix(in_oklab,_#0f1a2a_70%,_white_15%)]"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-[color-mix(in_oklab,_#0f1a2a_70%,_white_10%)]">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type your question…"
            className="
              flex-1 rounded-xl px-3 py-2
              bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_8%)]
              text-[#eaf2ff]
              placeholder-[#a3b3cc]
              border border-[color-mix(in_oklab,_#0f1a2a_70%,_white_12%)]
              outline-none
              focus:border-[#2a6cd6] focus:ring-2 focus:ring-[#2a6cd6]/30
            "
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="rounded-xl px-3 py-2 bg-[#2a6cd6] text-white disabled:opacity-40 hover:brightness-110 transition"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
