// src/components/AgentChat.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "agent"; content: string };
type AgentResponse = {
  content: string;
  sources?: { title: string; section?: string | null; url?: string | null }[];
  meta?: {
    clarify?: boolean;
    expect?: string;       // <- the clarifier key we should send back next turn
    summary?: string;
    mode?: "anon" | "signed";
  };
  requireLogin?: boolean;
};

const EXPECT_KEY = "ps_agent_expected_intent";

export default function AgentChat({
  endpoint = "/api/agent",
  title = "Ask Pace Shuttles",
}: {
  endpoint?: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "agent", content: "Hi! Ask me about countries, destinations, journeys, or vehicle types." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load last expected intent (survives reloads)
  const [expectedIntent, setExpectedIntent] = useState<string | undefined>(() => {
    try { return sessionStorage.getItem(EXPECT_KEY) || undefined; } catch { return undefined; }
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          expectedIntent, // <- echo the last clarifier (if any)
        }),
      });

      const data: AgentResponse = await res.json().catch(() => ({
        content:
          "Sorry — I couldn’t reach the assistant. Please try again, or email hello@paceshuttles.com.",
      }));

      // Persist next clarifier expectation, if provided
      const nextExpect = data?.meta?.expect;
      if (nextExpect) {
        setExpectedIntent(nextExpect);
        try { sessionStorage.setItem(EXPECT_KEY, nextExpect); } catch {}
      } else {
        // If no clarifier expected, clear any previous one
        setExpectedIntent(undefined);
        try { sessionStorage.removeItem(EXPECT_KEY); } catch {}
      }

      setMessages((m) => [...m, { role: "agent", content: data.content }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          content:
            "Sorry — something went wrong sending your question. Please try again, or email hello@paceshuttles.com.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto rounded-2xl border p-4 shadow-sm bg-white">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {expectedIntent && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 border">
            context: {expectedIntent}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="h-80 overflow-y-auto space-y-3 border rounded-lg p-3 bg-gray-50"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-xl px-3 py-2 bg-blue-600 text-white"
                : "mr-auto max-w-[85%] rounded-xl px-3 py-2 bg-white border"
            }
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto max-w-[85%] rounded-xl px-3 py-2 bg-white border italic text-gray-500">
            thinking…
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-lg border px-3 py-2"
          placeholder="Type your question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <button
          className="rounded-lg px-4 py-2 border bg-black text-white disabled:opacity-50"
          onClick={() => void send(input)}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
