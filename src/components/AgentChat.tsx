// src/components/AgentChat.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AgentResponse,
  AgentChoice,
} from "@/lib/agent/agent-schema";
import { createClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/*  Supabase auth (client-side)                                               */
/* -------------------------------------------------------------------------- */

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) return null;
  return createClient(url, anon);
}

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
  if (!iso) return "";
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
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

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
        { role: "assistant", content: "Oops — something went wrong. Can you try again?" },
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

      const newMessages: AgentMessage[] = [
        ...messages,
        { role: "user", content: choice.label, payload: choice.action },
        { role: "assistant", content: "Opening that journey in the schedule view for you…" },
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
    const sb = getSupabaseClient();
    if (!sb) {
      // If env isn't available in this build, treat as anon (chat still works)
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

  /* ------------------------------ Support UI ------------------------------ */
  const [mode, setMode] = useState<"chat" | "support">("chat");

  // Only allow support mode if authed
  useEffect(() => {
    if (!isAuthed && mode === "support") setMode("chat");
  }, [isAuthed, mode]);

  const [ticketStatusFilter, setTicketStatusFilter] = useState<
    "open" | "resolved" | "closed"
  >("open");
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

  async function loadTickets(status: TicketStatus) {
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(`/api/support/tickets?status=${status}`);
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load tickets");
      setTickets(data.tickets ?? []);
      // Auto-select first ticket (nice UX)
      if ((data.tickets ?? []).length > 0 && !selectedTicketId) {
        setSelectedTicketId(data.tickets[0].id);
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
      const res = await fetch(`/api/support/tickets/${id}`);
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load ticket");
      setTicketDetail({ ticket: data.ticket, thread: data.thread ?? [] });
    } catch (e: any) {
      setTicketDetail(null);
      setDetailError(e?.message ?? "Failed to load ticket");
    } finally {
      setDetailLoading(false);
    }
  }

  // Load tickets when support mode becomes active (and when filter changes)
  useEffect(() => {
    if (!isAuthed) return;
    if (mode !== "support") return;
    loadTickets(ticketStatusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, mode, ticketStatusFilter]);

  // Load ticket detail when selection changes
  useEffect(() => {
    if (!isAuthed) return;
    if (mode !== "support") return;
    if (!selectedTicketId) return;
    loadTicketDetail(selectedTicketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed, mode, selectedTicketId]);

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
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message ?? data?.error ?? "Failed to send reply");
      }

      setReplyMsg("");
      // Refresh detail and list (status may have changed)
      await loadTicketDetail(selectedTicketId);
      await loadTickets(ticketStatusFilter);
    } catch (e: any) {
      setReplyError(e?.message ?? "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }

  const supportAvailable = useMemo(() => auth.status !== "loading" && isAuthed, [auth, isAuthed]);

  /* --------------------------------- Render -------------------------------- */

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      {/* Top bar */}
      <div className="mt-6 mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {mode === "support" ? "Support" : "Chat"}
          </h2>
          <p className="text-sm text-slate-600">
            {mode === "support"
              ? "View your tickets and message a support agent."
              : "Instant help from the Pace Shuttles assistant."}
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

      {/* Mode switch (only show Support if logged in) */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setMode("chat")}
          className={`px-3 py-2 text-sm rounded-lg ring-1 ${
            mode === "chat"
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
          }`}
        >
          Chat
        </button>

        <button
          onClick={() => supportAvailable && setMode("support")}
          disabled={!supportAvailable}
          className={`px-3 py-2 text-sm rounded-lg ring-1 ${
            mode === "support"
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
          } disabled:opacity-50 disabled:hover:bg-white`}
          title={!supportAvailable ? "Sign in to access support tickets." : ""}
        >
          Support
        </button>

        {!supportAvailable && auth.status !== "loading" && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-slate-600">
              Need a human? Sign in to raise and track tickets.
            </span>
            <a
              href="/account"
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              Sign in
            </a>
          </div>
        )}
      </div>

      {/* Layout */}
      <div
        className={`grid gap-4 ${
          mode === "support" && supportAvailable ? "lg:grid-cols-5" : "grid-cols-1"
        }`}
      >
        {/* Chat panel */}
        <div className={mode === "support" && supportAvailable ? "lg:col-span-3" : ""}>
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
                    {pending ? "Thinking…" : "Online"}
                  </div>
                </div>
              </div>

              {/* Small hint shown only when not logged in */}
              {!supportAvailable && auth.status !== "loading" && (
                <div className="hidden sm:block text-xs text-slate-500">
                  Sign in to unlock tickets & human support
                </div>
              )}
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

              {/* Structured Button Choices */}
              {lastChoices.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {lastChoices.map((choice, i) => (
                    <button
                      key={i}
                      className="bg-blue-600 text-white px-3 py-2 rounded-xl hover:bg-blue-700 text-sm"
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

          {/* Logged-out friendly hint (below chat) */}
          {!supportAvailable && auth.status !== "loading" && (
            <div className="mt-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">
                Want a human to take over?
              </div>
              <div className="text-sm text-slate-600 mt-1">
                Sign in and you’ll be able to raise a ticket, track updates, and reply to support.
              </div>
              <div className="mt-3">
                <a
                  href="/account"
                  className="inline-flex items-center justify-center rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
                >
                  Sign in to enable support
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Support panel (only when logged in) */}
        {mode === "support" && supportAvailable && (
          <div className="lg:col-span-2">
            <div className="rounded-2xl ring-1 ring-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Your tickets</div>
                    <div className="text-xs text-slate-500">
                      Open ↔ Resolved ↔ Closed
                    </div>
                  </div>

                  {/* New ticket coming next (API not yet built) */}
                  <button
                    type="button"
                    disabled
                    className="text-xs rounded-lg px-3 py-2 bg-slate-100 text-slate-400 ring-1 ring-slate-200 cursor-not-allowed"
                    title="Next step: add /api/support/tickets (POST) for new tickets."
                  >
                    + New ticket
                  </button>
                </div>

                {/* Filters */}
                <div className="mt-3 flex gap-2">
                  {(["open", "resolved", "closed"] as TicketStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSelectedTicketId(null);
                        setTicketDetail(null);
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
                      When you raise tickets, they’ll appear here with updates from the support team.
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
                  <div className="text-sm text-slate-600">
                    Select a ticket to view the conversation.
                  </div>
                ) : detailLoading ? (
                  <div className="text-sm text-slate-600">Loading conversation…</div>
                ) : detailError ? (
                  <div className="text-sm text-red-600">{detailError}</div>
                ) : !ticketDetail ? (
                  <div className="text-sm text-slate-600">
                    Ticket not available.
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">
                          {ticketDetail.ticket.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          #{ticketDetail.ticket.number} • Created{" "}
                          {fmtDateTime(ticketDetail.ticket.createdAt)}
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
                        <div className="text-sm text-slate-600">
                          No public messages yet.
                        </div>
                      ) : (
                        ticketDetail.thread.map((a) => {
                          const isCustomer =
                            (a.sender ?? "").toLowerCase() === "customer";
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
                                <span className="font-medium">
                                  {isCustomer ? "You" : "Support"}
                                </span>
                                <span>{fmtDateTime(a.createdAt)}</span>
                              </div>
                              <div className="whitespace-pre-wrap">{a.body}</div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Reply box */}
                    <div className="mt-3">
                      {replyError && (
                        <div className="text-sm text-red-600 mb-2">{replyError}</div>
                      )}

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
                            replySending ||
                            ticketDetail.ticket.status === "closed" ||
                            !replyMsg.trim()
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
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-500">
              Tip: “Resolved” tickets automatically reopen if you reply. “Closed” tickets are final — you’ll need to raise a new one.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
