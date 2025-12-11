// src/components/AgentChat.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import type {
  AgentMessage,
  AgentResponse,
  AgentChoice,
} from "@/lib/agent/agent-schema";

export function AgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! 👋 I can help you explore destinations, availability and your bookings. How can I help?",
    },
  ]);
  const [pending, setPending] = useState(false);
  const [partialResponse, setPartialResponse] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  useEffect(scrollToBottom, [messages, pending, partialResponse]);

  function resetChat() {
    setMessages([
      {
        role: "assistant",
        content:
          "Restarted! How can I help with your Pace Shuttles adventure?",
      },
    ]);
  }

  async function callAgent(newMessages: AgentMessage[]) {
    setPending(true);
    setPartialResponse("");

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = (await res.json()) as AgentResponse;

      if (data.messages) {
        setMessages(data.messages);
      }

      if (data.choices) {
        setMessages((prev) => {
          if (!prev.length) return prev;
          const updated = [...prev];
          updated[updated.length - 1].choices = data.choices;
          return updated;
        });
      }
    } catch (err) {
      console.error("Agent failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Oops — something went wrong. Can you try again?",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  function handleSend(msg: string) {
    if (!msg.trim()) return;
    const newMessages = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    callAgent(newMessages);
  }

  function handleChoice(choice: AgentChoice) {
    // SPECIAL CASE: journey buttons with deep-link URLs
    const action: any = (choice as any).action;
    if (action && action.type === "openJourney" && action.url) {
      const url: string = action.url;

      // Optionally add a little context message in the chat
      const newMessages: AgentMessage[] = [
        ...messages,
        {
          role: "user",
          content: choice.label,
          payload: choice.action,
        },
        {
          role: "assistant",
          content: "Opening that journey in the schedule view for you…",
        },
      ];
      setMessages(newMessages);

      // Navigate to the filtered journey page
      if (typeof window !== "undefined") {
        window.location.href = url;
      }

      return;
    }

    // DEFAULT: send the button label back into the agent as a user message
    const newMessages = [
      ...messages,
      { role: "user", content: choice.label, payload: choice.action },
    ];
    setMessages(newMessages);
    callAgent(newMessages);
  }

  const last = messages[messages.length - 1];
  const lastChoices = last?.choices ?? [];

  return (
    <div className="flex flex-col h-[85vh] w-full max-w-xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-semibold text-lg">Chat with Pace Shuttles</h2>

        <button
          onClick={resetChat}
          className="text-sm underline text-gray-600 hover:text-black"
        >
          Start over
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 border rounded-md p-3 bg-white">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-md max-w-[80%] ${
              m.role === "assistant"
                ? "bg-gray-100 text-black"
                : "bg-blue-600 text-white ml-auto"
            }`}
          >
            {m.content}
          </div>
        ))}

        {/* Streaming indicator */}
        {pending && (
          <div className="bg-gray-100 text-black p-3 rounded-md w-24 animate-pulse">
            •••
          </div>
        )}

        {/* Structured Button Choices */}
        {lastChoices.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {lastChoices.map((choice, i) => (
              <button
                key={i}
                className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 text-sm"
                onClick={() => handleChoice(choice)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget as HTMLFormElement & {
            message: { value: string };
          };
          const val = form.message.value;
          form.reset();
          handleSend(val);
        }}
      >
        <input
          name="message"
          className="flex-1 border rounded-md p-2"
          placeholder="Ask about countries, destinations, bookings..."
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white px-4 rounded-md disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}
