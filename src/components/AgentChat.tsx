// src/components/AgentChat.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AgentResponse,
  AgentChoice,
} from "@/lib/agent/agent-schema";
import { createBrowserClient } from "@supabase/ssr";

/* -------------------------------------------------------------------------- */
/*  Supabase auth (client-side) — MUST match the rest of the app              */
/* -------------------------------------------------------------------------- */

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* -------------------------------------------------------------------------- */
/*  Optional Zammad Chat widget (for live agent “drop-in”)                    */
/*  - Requires you to paste the widget snippet values into env vars.          */
/*  - If not configured / no agents available, we fall back to ticket.        */
/* -------------------------------------------------------------------------- */

declare global {
  interface Window {
    // Zammad widget uses a function named `zammadChat` in many deployments.
    // We keep it loose because implementations vary.
    zammadChat?: any;
  }
}

const ZAMMAD_CHAT_HOST = process.env.NEXT_PUBLIC_ZAMMAD_CHAT_HOST; // e.g. "https://pace-shuttles-helpdesk.zammad.com"
const ZAMMAD_CHAT_ID = process.env.NEXT_PUBLIC_ZAMMAD_CHAT_ID; // e.g. "1"

type AuthState =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "authed"; email: string };

type TicketStatus = "open" | "resolved" | "closed";
type TicketRow = {
  id: number;
  number: string;
  title: string;
  status: TicketStatus;
  createdAt: string | null;
  updatedAt: string | null;
  description: string | null;
};

type TicketDetail = {
  ticket: {
    id: number;
    number: string;
    title: string;
    status: TicketStatus;
    createdAt: string | null;
    updatedAt: string | null;
  };
  thread: Array<{
    id: number;
    createdAt: string | null;
    subject: string;
    body: string;
    sender: string;
    type: string;
  }>;
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusPill(status: TicketStatus) {
  switch (status) {
    case "open":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "resolved":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "closed":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function humanStatus(status: TicketStatus) {
  if (status === "open") return "Open";
  if (status === "resolved") return "Resolved";
  return "Closed";
}

/* -------------------------------------------------------------------------- */
/*  Escalation rules (v1)                                                     */
/* -------------------------------------------------------------------------- */

function looksLikeHumanRequest(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes("human") ||
    t.includes("agent") ||
    t.includes("representative") ||
    t.includes("person") ||
    t.includes("someone real") ||
    t.includes("talk to") ||
    t.includes("speak to") ||
    t.includes("live chat")
  );
}

function looksFrustrated(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes("frustrat") ||
    t.includes("annoy") ||
    t.includes("angry") ||
    t.includes("unacceptable") ||
    t.includes("ridiculous") ||
    t.includes("useless") ||
    t.includes("this is bad") ||
    t.includes("doesn't work") ||
    t.includes("does not work") ||
    t.includes("still not working")
  );
}

function buildTranscript(msgs: AgentMessage[]) {
  // Whole agent chat history, suitable for “public view” in the ticket.
  // Keep it simple & readable.
  return msgs
    .filter((m) => typeof m?.content === "string" && m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

export function AgentChat() {
  /* ------------------------------ Chat state ------------------------------ */
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! 👋 I can help you explore destinations, availability and your bookings. How can I help?",
    },
  ]);
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };
  useEffect(scrollToBottom, [messages, pending]);

  function resetChat() {
    setMessages([
      {
        role: "assistant",
        content: "Restarted! How can I help with your Pace Shuttles adventure?",
      },
    ]);
    setEscalationOpen(false);
    setLiveChatMode(false);
  }

  async function callAgent(newMessages: AgentMessage[]) {
    setPending(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = (await res.json()) as AgentResponse;

      if (data.messages) setMessages(data.messages);

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

    // Intercept “human / frustration” escalation (v1).
    const shouldOfferEscalation = looksLikeHumanRequest(msg) || looksFrustrated(msg);

    if (shouldOfferEscalation) {
      if (!isAuthed) {
        // Not logged in: we cannot raise/track tickets for this user.
        const next: AgentMessage[] = [
          ...messages,
          { role: "user", content: msg },
          {
            role: "assistant",
            content:
              "I can bring in a human, but you’ll need to log in first so we can connect it to your support record. Use the Login button in the header, then come back here and I’ll hand it over.",
          },
        ];
        setMessages(next);
        return;
      }

      // Logged in: offer live agent (and ticket fallback)
      const next: AgentMessage[] = [
        ...messages,
        { role: "user", content: msg },
        {
          role: "assistant",
          content:
            "Would you like to contact a live agent? If no one is available, I can raise a ticket and an agent will get back to you — with the full transcript.",
        },
      ];
      setMessages(next);
      setEscalationOpen(true);
      return;
    }

    const newMessages = [...messages, { role: "user", content: msg }];
    setMessages(newMessages);
    callAgent(newMessages);
  }

  function handleChoice(choice: AgentChoice) {
    // SPECIAL CASE: journey buttons with deep-link URLs
    const action: any = (choice as any).action;
    if (action && action.type === "openJourney" && action.url) {
      const url: string = action.url;

      const newMessages: AgentMessage[] = [
        ...messages,
        { role: "user", content: choice.label, payload: choice.action },
        {
          role: "assistant",
          content: "Opening that journey in the schedule view for you…",
        },
      ];
      setMessages(newMessages);

      if (typeof window !== "undefined") window.location.href = url;
      return;
    }

    const newMessages = [
      ...messages,
      { role: "user", content: choice.label, payload: choice.action },
    ];
    setMessages(newMessages);
    callAgent(newMessages);
  }

  const last = messages[messages.length - 1];
  const lastChoices = last?.choices ?? [];

  /* ------------------------------ Auth state ------------------------------ */
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    if (!sb) {
      setAuth({ status: "anon" });
      return;
    }

    let mounted = true;

    (async () => {
      const { data } = await sb.auth.getSession();
      const email = data.session?.user?.email ?? null;
      if (!mounted) return;
      if (email) setAuth({ status: "authed", email });
      else setAuth({ status: "anon" });
    })();

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      if (!mounted) return;
      if (email) setAuth({ status: "authed", email });
      else setAuth({ status: "anon" });
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAuthed = auth.status === "authed";

  /* ------------------------------ Tickets UI ------------------------------ */
  const [ticketStatusFilter, setTicketStatusFilter] =
    useState<TicketStatus>("open");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);

  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [replyMsg, setReplyMsg] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // New ticket modal state
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newRef, setNewRef] = useState("");
  const [newOutcome, setNewOutcome] = useState("");
  const [newErr, setNewErr] = useState<string | null>(null);
  const [newBusy, setNewBusy] = useState(false);

  async function loadTickets(status: TicketStatus) {
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/support/tickets?status=${status}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok)
        throw new Error(data?.error ?? "Failed to load tickets");

      const rows: TicketRow[] = data.tickets ?? [];
      setTickets(rows);

      if (rows.length > 0 && !selectedTicketId) {
        setSelectedTicketId(rows[0].id);
      }
      if (selectedTicketId && !rows.some((r) => r.id === selectedTicketId)) {
        setSelectedTicketId(rows[0]?.id ?? null);
        setTicketDetail(null);
      }
    } catch (e: any) {
      setTicketsError(e?.message ?? "Failed to load tickets");
    } finally {
      setTicketsLoading(false);
    }
  }

  async function loadTicketDetail(id: number) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok)
        throw new Error(data?.error ?? "Failed to load ticket");
      setTicketDetail({ ticket: data.ticket, thread: data.thread ?? [] });
    } catch (e: any) {
      setTicketDetail(null);
      setDetailError(e?.message ?? "Failed to load ticket");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthed) {
      setTickets([]);
      setTicketsError(null);
      setTicketsLoading(false);
      setSelectedTicketId(null);
      setTicketDetail(null);
      setDetailError(null);
      setReplyMsg("");
      setReplyError(null);
      setReplySending(false);
      setNewOpen(false);
      setEscalationOpen(false);
      setLiveChatMode(false);
      return;
    }
    loadTickets(ticketStatusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

  useEffect(() => {
    if (!isAuthed) return;
    loadTickets(ticketStatusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, ticketStatusFilter]);

  useEffect(() => {
    if (!isAuthed) return;
    if (!selectedTicketId) return;
    loadTicketDetail(selectedTicketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, selectedTicketId]);

  async function sendReply() {
    if (!selectedTicketId) return;
    const msg = replyMsg.trim();
    if (!msg) return;

    setReplySending(true);
    setReplyError(null);

    try {
      const res = await fetch(`/api/support/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.message ?? data?.error ?? "Failed to send reply");
      }

      setReplyMsg("");
      await loadTicketDetail(selectedTicketId);
      await loadTickets(ticketStatusFilter);
    } catch (e: any) {
      setReplyError(e?.message ?? "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }

  async function createNewTicket(overrides?: {
    title?: string | null;
    message?: string | null;
    reference?: string | null;
    desiredOutcome?: string | null;
    ai_escalation_reason?: string | null;
  }) {
    setNewErr(null);

    const bodyText = (overrides?.message ?? newMessage).trim();
    if (!bodyText) {
      setNewErr("Please describe what you need help with.");
      return;
    }

    setNewBusy(true);
    try {
      const res = await fetch(`/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title:
            overrides?.title ??
            (newTitle.trim() ? newTitle.trim() : null),
          message: bodyText,
          reference:
            overrides?.reference ??
            (newRef.trim() ? newRef.trim() : null),
          desiredOutcome:
            overrides?.desiredOutcome ??
            (newOutcome.trim() ? newOutcome.trim() : null),
          ai_escalation_reason: overrides?.ai_escalation_reason ?? null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to create ticket");
      }

      // Reset modal fields
      setNewOpen(false);
      setNewTitle("");
      setNewMessage("");
      setNewRef("");
      setNewOutcome("");

      // Switch to Open tickets and refresh
      setTicketStatusFilter("open");
      await loadTickets("open");

      // Select created ticket
      const createdId = data.ticket?.id as number | undefined;
      if (createdId) {
        setSelectedTicketId(createdId);
        await loadTicketDetail(createdId);
      }

      // Helpful in-chat confirmation
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Done — I’ve raised a ticket for you and included the transcript. A support agent will get back to you as soon as possible.",
        },
      ]);
    } catch (e: any) {
      setNewErr(e?.message ?? "Failed to create ticket");
    } finally {
      setNewBusy(false);
    }
  }

  /* ------------------------- Escalation (live agent) ---------------------- */
  const [escalationOpen, setEscalationOpen] = useState(false);
  const [escalationBusy, setEscalationBusy] = useState(false);
  const [escalationErr, setEscalationErr] = useState<string | null>(null);

  const [liveChatMode, setLiveChatMode] = useState(false);
  const transcript = useMemo(() => buildTranscript(messages), [messages]);

  async function ensureZammadWidgetLoaded(): Promise<boolean> {
    // If you already inject the widget globally elsewhere, this will be a no-op.
    if (!ZAMMAD_CHAT_HOST || !ZAMMAD_CHAT_ID) return false;
    if (typeof window === "undefined") return false;

    // If function already present, assume loaded.
    if (typeof window.zammadChat === "function") return true;

    // Try to load the widget script. Many Zammad installs expose it at /assets/chat/chat.min.js
    // (If your URL differs, set up a proper embed separately.)
    const scriptUrl = `${ZAMMAD_CHAT_HOST.replace(/\/$/, "")}/assets/chat/chat.min.js`;

    // Avoid double-inject
    if (document.querySelector(`script[data-ps-zammad-chat="1"]`)) {
      // Give it a moment to attach
      await new Promise((r) => setTimeout(r, 300));
      return typeof window.zammadChat === "function";
    }

    await new Promise<void>((resolve) => {
      const s = document.createElement("script");
      s.src = scriptUrl;
      s.async = true;
      s.setAttribute("data-ps-zammad-chat", "1");
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.body.appendChild(s);
    });

    return typeof window.zammadChat === "function";
  }

  async function startLiveAgentFlow() {
    setEscalationBusy(true);
    setEscalationErr(null);

    try {
      // 1) Load widget if configured.
      const loaded = await ensureZammadWidgetLoaded();

      // 2) If widget available, start it. If no agents are available,
      // Zammad simply won’t display it (per Zammad’s behaviour).
      if (loaded && ZAMMAD_CHAT_HOST && ZAMMAD_CHAT_ID) {
        try {
          window.zammadChat?.({
            host: ZAMMAD_CHAT_HOST,
            chatId: Number(ZAMMAD_CHAT_ID),
            // You can enable debug in Zammad widget if needed:
            // debug: true,
          });

          setLiveChatMode(true);
          setEscalationOpen(false);

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Connecting you to a live agent now… If no one is available, I can raise a ticket with the full transcript.",
            },
          ]);

          // Give widget a moment to show; if it doesn’t, we fall back to ticket.
          await new Promise((r) => setTimeout(r, 1200));

          // If Zammad doesn’t show (e.g. no agents available), we can’t reliably detect it
          // without deeper widget hooks. For now, offer ticket fallback immediately.
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "If you don’t see the live chat widget appear, it usually means no agents are available right now. Would you like me to raise a ticket instead?",
            },
          ]);

          // Keep the escalation modal closed; user can hit “New ticket” or we can pop modal.
          return;
        } catch {
          // fall through to ticket fallback
        }
      }

      // Not configured / couldn’t load widget: fallback to ticket creation offer
      setEscalationErr(
        "Live chat isn’t available right now. I can raise a ticket and a support agent will get back to you."
      );
    } finally {
      setEscalationBusy(false);
    }
  }

  function openTicketFromTranscript() {
    if (!isAuthed) return;

    // Pre-fill the ticket modal, but keep user in control (no extra forms required beyond confirm).
    setNewErr(null);
    setNewTitle(""); // Let server derive
    setNewRef("");
    setNewOutcome("Talk to a human / handover from chat");
    setNewMessage(
      `Transcript (Pace Shuttles Assistant)\n\n${transcript}`
    );
    setNewOpen(true);
    setEscalationOpen(false);

    // Also add a small in-chat message so it feels continuous
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          "No problem — I can raise a ticket for a human to pick up. I’ll include the full chat transcript so you don’t have to repeat yourself.",
      },
    ]);
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      {/* Page header */}
      <div className="mt-6 mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Chat</h2>
          <p className="text-sm text-slate-600">
            Instant help from the Pace Shuttles assistant.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {auth.status === "authed" ? (
            <span className="text-xs rounded-full px-3 py-1 bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              Signed in as <span className="font-medium">{auth.email}</span>
            </span>
          ) : auth.status === "loading" ? (
            <span className="text-xs rounded-full px-3 py-1 bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              Checking sign-in…
            </span>
          ) : (
            <span className="text-xs rounded-full px-3 py-1 bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              Not signed in
            </span>
          )}

          <button
            onClick={resetChat}
            className="text-sm underline text-slate-600 hover:text-slate-900"
          >
            Start over
          </button>
        </div>
      </div>

      {/* Layout */}
      <div className={`grid gap-4 ${isAuthed ? "lg:grid-cols-5" : "grid-cols-1"}`}>
        {/* Chat panel (always) */}
        <div className={isAuthed ? "lg:col-span-3" : ""}>
          <div className="rounded-2xl ring-1 ring-slate-200 bg-white shadow-sm">
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white text-sm">
                  PS
                </span>
                <div>
                  <div className="text-sm font-semibold">Pace Shuttles Assistant</div>
                  <div className="text-xs text-slate-500">
                    {pending ? "Thinking…" : liveChatMode ? "Live agent mode" : isAuthed ? "Connected" : "Online"}
                  </div>
                </div>
              </div>

              {!isAuthed && auth.status !== "loading" ? (
                <div className="hidden sm:block text-xs text-slate-500">
                  Sign in to unlock ticket tracking & human support.
                </div>
              ) : null}
            </div>

            {/* Messages */}
            <div className="h-[70vh] overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ring-1 ${
                      m.role === "assistant"
                        ? "bg-slate-50 text-slate-900 ring-slate-200"
                        : "bg-blue-600 text-white ring-blue-600"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {pending && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 text-slate-900 ring-1 ring-slate-200 px-4 py-3 rounded-2xl w-24 animate-pulse text-sm">
                    •••
                  </div>
                </div>
              )}

              {lastChoices.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {lastChoices.map((choice, i) => (
                    <button
                      key={i}
                      className="bg-blue-600 text-white px-3 py-2 rounded-xl hover:bg-blue-700 text-sm disabled:opacity-60"
                      onClick={() => handleChoice(choice)}
                      disabled={pending}
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
              className="p-4 border-t border-slate-100 flex gap-2"
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
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ask about countries, destinations, bookings…"
                disabled={pending}
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm disabled:opacity-60 hover:bg-blue-700"
              >
                Send
              </button>
            </form>
          </div>
        </div>

        {/* Tickets panel (only when logged in) */}
        {isAuthed && (
          <div className="lg:col-span-2">
            <div className="rounded-2xl ring-1 ring-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Your tickets</div>
                    <div className="text-xs text-slate-500">Open ↔ Resolved ↔ Closed</div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNewErr(null);
                      setNewOpen(true);
                    }}
                    className="text-xs rounded-lg px-3 py-2 bg-slate-900 text-white ring-1 ring-slate-900 hover:bg-slate-800"
                  >
                    + New ticket
                  </button>
                </div>

                <div className="mt-3 flex gap-2">
                  {(["open", "resolved", "closed"] as TicketStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setTicketDetail(null);
                        setSelectedTicketId(null);
                        setTicketStatusFilter(s);
                      }}
                      className={`text-xs rounded-lg px-3 py-2 ring-1 ${
                        ticketStatusFilter === s
                          ? "bg-slate-900 text-white ring-slate-900"
                          : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {humanStatus(s)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ticket list */}
              <div className="max-h-[28vh] overflow-y-auto border-b border-slate-100">
                {ticketsLoading ? (
                  <div className="p-4 text-sm text-slate-600">Loading tickets…</div>
                ) : ticketsError ? (
                  <div className="p-4 text-sm text-red-600">{ticketsError}</div>
                ) : tickets.length === 0 ? (
                  <div className="p-4">
                    <div className="text-sm font-semibold text-slate-900">
                      No {humanStatus(ticketStatusFilter)} tickets
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      When tickets are raised, they’ll appear here with support updates.
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {tickets.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTicketId(t.id)}
                        className={`w-full text-left p-4 hover:bg-slate-50 ${
                          selectedTicketId === t.id ? "bg-slate-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {t.title || `Ticket #${t.number}`}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              Updated {fmtDateTime(t.updatedAt)}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 text-xs px-2 py-1 rounded-full ring-1 ${statusPill(
                              t.status
                            )}`}
                          >
                            {humanStatus(t.status)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Ticket detail */}
              <div className="p-4">
                {!selectedTicketId ? (
                  <div className="text-sm text-slate-600">Select a ticket to view the conversation.</div>
                ) : detailLoading ? (
                  <div className="text-sm text-slate-600">Loading conversation…</div>
                ) : detailError ? (
                  <div className="text-sm text-red-600">{detailError}</div>
                ) : !ticketDetail ? (
                  <div className="text-sm text-slate-600">Ticket not available.</div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {ticketDetail.ticket.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          #{ticketDetail.ticket.number} • Created {fmtDateTime(ticketDetail.ticket.createdAt)}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-xs px-2 py-1 rounded-full ring-1 ${statusPill(
                          ticketDetail.ticket.status
                        )}`}
                      >
                        {humanStatus(ticketDetail.ticket.status)}
                      </span>
                    </div>

                    <div className="mt-3 max-h-[22vh] overflow-y-auto space-y-2 pr-1">
                      {ticketDetail.thread.length === 0 ? (
                        <div className="text-sm text-slate-600">No public messages yet.</div>
                      ) : (
                        ticketDetail.thread.map((a) => {
                          const isCustomer = (a.sender ?? "").toLowerCase() === "customer";
                          return (
                            <div
                              key={a.id}
                              className={`rounded-xl px-3 py-2 text-sm ring-1 ${
                                isCustomer
                                  ? "bg-blue-50 text-slate-900 ring-blue-200"
                                  : "bg-slate-50 text-slate-900 ring-slate-200"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                                <span className="font-medium">{isCustomer ? "You" : "Support"}</span>
                                <span>{fmtDateTime(a.createdAt)}</span>
                              </div>
                              <div className="whitespace-pre-wrap">{a.body}</div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="mt-3">
                      {replyError && <div className="text-sm text-red-600 mb-2">{replyError}</div>}

                      <div className="flex gap-2">
                        <textarea
                          value={replyMsg}
                          onChange={(e) => setReplyMsg(e.target.value)}
                          placeholder={
                            ticketDetail.ticket.status === "closed"
                              ? "This ticket is closed. Create a new ticket for further help."
                              : "Reply to support…"
                          }
                          disabled={replySending || ticketDetail.ticket.status === "closed"}
                          className="min-h-[44px] max-h-28 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={
                            replySending || ticketDetail.ticket.status === "closed" || !replyMsg.trim()
                          }
                          className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm disabled:opacity-60 hover:bg-blue-700"
                        >
                          {replySending ? "Sending…" : "Send"}
                        </button>
                      </div>

                      {ticketDetail.ticket.status === "resolved" && (
                        <div className="mt-2 text-xs text-slate-500">
                          Replying will reopen this ticket (Resolved → Open).
                        </div>
                      )}
                      {ticketDetail.ticket.status === "closed" && (
                        <div className="mt-2 text-xs text-slate-500">
                          Closed tickets can’t be reopened. Please raise a new ticket.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-500">
              “Resolved” tickets reopen automatically when you reply. “Closed” tickets are final.
            </div>
          </div>
        )}
      </div>

      {/* Escalation Modal (logged-in only) */}
      {isAuthed && escalationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (escalationBusy ? null : setEscalationOpen(false))}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Contact a live agent?</div>
                <div className="text-xs text-slate-500">
                  If no one is available, we can raise a ticket and an agent will get back to you.
                </div>
              </div>
              <button
                onClick={() => (escalationBusy ? null : setEscalationOpen(false))}
                className="text-slate-500 hover:text-slate-900 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {escalationErr && (
                <div className="text-sm text-amber-800 bg-amber-50 ring-1 ring-amber-200 rounded-xl px-3 py-2">
                  {escalationErr}
                </div>
              )}

              <div className="text-sm text-slate-700">
                We’ll keep the conversation seamless — no forms. Your full transcript will be included if we create a ticket.
              </div>

              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <div className="text-xs font-medium text-slate-700 mb-1">Transcript preview</div>
                <pre className="text-xs text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {transcript}
                </pre>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                onClick={() => openTicketFromTranscript()}
                className="text-sm rounded-xl px-4 py-2 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
                disabled={escalationBusy}
              >
                No — raise a ticket
              </button>
              <button
                onClick={startLiveAgentFlow}
                className="text-sm rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                disabled={escalationBusy}
              >
                {escalationBusy ? "Checking…" : "Yes — live agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Ticket Modal (logged-in only) */}
      {isAuthed && newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (newBusy ? null : setNewOpen(false))}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Create a new ticket</div>
                <div className="text-xs text-slate-500">
                  Tell us what happened — we’ll route it to the right support team.
                </div>
              </div>
              <button
                onClick={() => (newBusy ? null : setNewOpen(false))}
                className="text-slate-500 hover:text-slate-900 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {newErr && (
                <div className="text-sm text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl px-3 py-2">
                  {newErr}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-slate-700">Short title (optional)</label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Payment failed on checkout"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={newBusy}
                />
                <div className="mt-1 text-xs text-slate-500">
                  If you leave this blank, we’ll create a helpful title automatically.
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">What do you need help with? *</label>
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Describe the issue or question. Include what you tried and what happened."
                  className="mt-1 w-full min-h-[120px] rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={newBusy}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Reference (optional)</label>
                  <input
                    value={newRef}
                    onChange={(e) => setNewRef(e.target.value)}
                    placeholder="Booking #, journey, route…"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={newBusy}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700">Desired outcome (optional)</label>
                  <input
                    value={newOutcome}
                    onChange={(e) => setNewOutcome(e.target.value)}
                    placeholder="What would ‘fixed’ look like?"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={newBusy}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                onClick={() => (newBusy ? null : setNewOpen(false))}
                className="text-sm rounded-xl px-4 py-2 ring-1 ring-slate-200 hover:bg-slate-50"
                disabled={newBusy}
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  createNewTicket({
                    title: newTitle.trim() ? newTitle.trim() : null,
                    message: newMessage.trim(),
                    reference: newRef.trim() ? newRef.trim() : null,
                    desiredOutcome: newOutcome.trim() ? newOutcome.trim() : null,
                    ai_escalation_reason:
                      newMessage.includes("Transcript (Pace Shuttles Assistant)")
                        ? "Chat escalation: user requested a human (transcript included)."
                        : "User created ticket from Support page.",
                  })
                }
                className="text-sm rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                disabled={newBusy}
              >
                {newBusy ? "Creating…" : "Create ticket"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
