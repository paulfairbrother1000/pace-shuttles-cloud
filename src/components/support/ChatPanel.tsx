"use client";
import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, Button } from "@/components/ui/Card";

type Message = { role: "user" | "agent"; content: string };

export default function ChatPanel({ authed }: { authed: boolean }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "agent",
      content: authed
        ? "Hi! I can answer general questions and also help with your bookings. How can I help today?"
        : "Hi! I can answer general questions about routes, journeys, and policies. To discuss your bookings, please sign in.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim()) return;
    const newMsgs = [...messages, { role: "user", content: input } as Message];
    setMessages(newMsgs);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await res.json();
      const text = data?.content || "Sorry, I didn’t get that.";
      setMessages([...newMsgs, { role: "agent", content: text }]);
    } catch {
      setMessages([...newMsgs, { role: "agent", content: "Something went wrong. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-3xl w-full mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Pace Support</h2>
          {!authed && (
            <a href="/login" className="text-sm text-blue-600 hover:underline">
              Sign in for booking help
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[60vh] overflow-auto">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-line ${
                  m.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
            placeholder="Type your question…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button type="submit" className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700">
            {busy ? "Sending…" : "Send"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
