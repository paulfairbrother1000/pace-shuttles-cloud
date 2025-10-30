// src/components/AgentChat.tsx
"use client";

import * as React from "react";

/* ──────────────────────────────────────────────
   Types
   ────────────────────────────────────────────── */
type SourceLink = { title: string; section?: string | null; url?: string | null };

type ChatMsg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceLink[];
  meta?: {
    clarify?: boolean;
    expect?: string | null; // server suggests the next expected intent
    requireLogin?: boolean;
    mode?: "anon" | "signed";
    usedSnippets?: number;
    summary?: string;
  };
};

type AgentResponse = {
  content: string;
  sources?: SourceLink[];
  requireLogin?: boolean;
  meta?: {
    clarify?: boolean;
    expect?: string | null;
    mode?: "anon" | "signed";
    usedSnippets?: number;
    summary?: string;
  };
};

/* ──────────────────────────────────────────────
   Small helpers
   ────────────────────────────────────────────── */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const EXPECT_KEY = "ps_agent_expected_intent";

function loadExpectedIntent(): string | null {
  try {
    return sessionStorage.getItem(EXPECT_KEY);
  } catch {
    return null;
  }
}
function saveExpectedIntent(v: string | null) {
  try {
    if (!v) sessionStorage.removeItem(EXPECT_KEY);
    else sessionStorage.setItem(EXPECT_KEY, v);
  } catch {}
}

/* ──────────────────────────────────────────────
   Component
   ────────────────────────────────────────────── */
export default function AgentChat({
  endpoint = "/api/agent",
  title = "Ask Pace Shuttles",
  showSources = false, // NEW: hide citations by default
}: {
  endpoint?: string;
  title?: string;
  showSources?: boolean;
}) {
  const [messages, setMessages] = React.useState<ChatMsg[]>([]);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expectedIntent, setExpectedIntent] = React.useState<string | null>(
    loadExpectedIntent()
  );

  // Keep expectedIntent mirrored to sessionStorage
  React.useEffect(() => {
    saveExpectedIntent(expectedIntent);
  }, [expectedIntent]);

  // Quick replies for common clarifiers (kept generic; server won’t ask for countries anymore)
  const quickReplies: Record<string, string[] | undefined> = {
    wantsCountryList: ["today", "roadmap"],
    // Add more when you add other clarifier paths:
    // wantsDestinations: ["all destinations", "destinations in Antigua"],
  };

  async function send(payloadText?: string) {
    const q = (payloadText ?? text).trim();
    if (!q || busy) return;

    // Always re-read expectedIntent from sessionStorage before sending (in case another tab updated it)
    const memoryIntent = expectedIntent || loadExpectedIntent();

    // Push user message into the timeline
    const userMsg: ChatMsg = { id: uid(), role: "user", content: q };
    setMessages((prev) => [...prev, userMsg]);
    if (!payloadText) setText("");
    setBusy(true);
    setError(null);

    // Build payload
    const payload: Record<string, any> = { message: q };
    if (memoryIntent) payload.expectedIntent = memoryIntent;

    let data: AgentResponse | null = null;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Agent error: ${res.status} ${res.statusText} ${txt}`);
      }
      data = (await res.json()) as AgentResponse;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message || "Unable to reach the agent.");
      return;
    }

    // Update expected intent memory:
    // - if server continues to expect something, store it;
    // - otherwise clear it to avoid loops.
    const nextExpect = data?.meta?.expect ?? null;
    setExpectedIntent(nextExpect || null);

    // Render assistant message
    const assistantMsg: ChatMsg = {
      id: uid(),
      role: "assistant",
      content: data?.content ?? "(no response)",
      // Hide sources unless explicitly enabled by prop
      sources: showSources ? data?.sources ?? [] : [],
      meta: {
        clarify: !!data?.meta?.clarify,
        expect: nextExpect,
        requireLogin: !!data?.requireLogin,
        mode: data?.meta?.mode,
        usedSnippets: data?.meta?.usedSnippets,
        summary: data?.meta?.summary,
      },
    };

    setMessages((prev) => [...prev, assistantMsg]);
    setBusy(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Simple, clean UI (no external CSS)
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 16,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{title}</h2>

        {/* Debug chip: shows what the server expects next */}
        {expectedIntent ? (
          <span
            title="The assistant asked a clarifying question; your next message will include this context so it can resolve it."
            style={{
              marginLeft: "auto",
              fontSize: 12,
              background: "#eef2ff",
              border: "1px solid #c7d2fe",
              color: "#3730a3",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            context: <strong>{expectedIntent}</strong>
          </span>
        ) : null}
      </div>

      {/* Message list */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#fff",
          minHeight: 240,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 14 }}>
            Ask things like:
            <ul style={{ marginTop: 6, paddingLeft: 18 }}>
              <li>What countries do you operate in?</li>
              <li>What destinations do you visit in Antigua?</li>
              <li>Show journeys in Antigua on 2025-11-20</li>
            </ul>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} showSources={showSources} />
            ))}
          </div>
        )}
      </div>

      {/* Quick replies when a clarifier is active */}
      {expectedIntent && quickReplies[expectedIntent]?.length ? (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {quickReplies[expectedIntent]!.map((label) => (
            <button
              key={label}
              onClick={() => void send(label)}
              disabled={busy}
              style={{
                background: "#f3f4f6",
                color: "#111827",
                border: "1px solid #e5e7eb",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 13,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{error}</div>
      ) : null}

      {/* Composer */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          placeholder="Type your question…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          style={{
            flex: 1,
            border: "1px solid #d1d5db",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          onClick={() => void send()}
          disabled={busy || !text.trim()}
          style={{
            background: busy ? "#9ca3af" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "10px 14px",
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>

      {/* Tiny footer */}
      <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
        Tip: if the assistant asks a clarifying question, your next message will include the
        “context” shown above so it doesn’t forget.
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Message bubble with lite markdown
   ────────────────────────────────────────────── */
function MessageBubble({
  msg,
  showSources,
}: {
  msg: ChatMsg;
  showSources?: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div style={{ justifySelf: isUser ? "end" : "start", maxWidth: "85%" }}>
      <div
        style={{
          background: isUser ? "#2563eb" : "#f9fafb",
          color: isUser ? "white" : "#111827",
          border: isUser ? "1px solid #2563eb" : "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "10px 12px",
          whiteSpace: "pre-wrap",
          lineHeight: 1.4,
          fontSize: 14,
        }}
        dangerouslySetInnerHTML={{ __html: renderMarkdownLite(msg.content) }}
      />

      {/* Sources (hidden by default) */}
      {showSources && msg.sources && msg.sources.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Sources:</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {msg.sources.map((s, i) => (
              <li key={i} style={{ fontSize: 12 }}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                    {s.section ? ` › ${s.section}` : ""}
                  </a>
                ) : (
                  <>
                    {s.title}
                    {s.section ? ` › ${s.section}` : ""}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg.meta?.requireLogin ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#b45309" }}>
          Please sign in to continue (privacy safeguard for account lookups).
        </div>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────
   Ultra-light markdown renderer
   ────────────────────────────────────────────── */
function renderMarkdownLite(raw: string): string {
  let s = raw || "";

  // Escape basic HTML
  s = s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));

  // **bold**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    `<a href="$2" target="_blank" rel="noreferrer">$1</a>`
  );

  // Bullets starting with "- " or "• "
  s = s
    .split("\n")
    .map((line) => {
      if (/^\s*[-•]\s+/.test(line)) return `<li>${line.replace(/^\s*[-•]\s+/, "")}</li>`;
      return line;
    })
    .join("\n");

  // Wrap consecutive <li>… blocks into a <ul>
  s = s.replace(/(?:\s*<li>[\s\S]*?<\/li>\s*)+/g, (block) => `<ul>${block}</ul>`);

  // Newlines → <br/>
  s = s.replace(/\n/g, "<br/>");

  return s;
}
