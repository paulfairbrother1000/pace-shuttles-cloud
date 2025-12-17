// src/components/AgentChat.tsx
"use client";

import { useEffect, useRef, useState } from "react";
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

  async function createNewTicket() {
    setNewErr(null);
    const body = newMessage.trim();
    if (!body) {
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
          title: newTitle.trim() ? newTitle.trim() : null,
          message: body,
          reference: newRef.trim() ? newRef.trim() : null,
          desiredOutcome: newOutcome.trim() ? newOutcome.trim() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to create ticket");
      }

      // Reset modal
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
    } catch (e: any) {
      setNewErr(e?.message ?? "Failed to create ticket");
    } finally {
      setNewBusy(false);
    }
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
      <div
        className={`grid gap-4 ${isAuthed ? "lg:grid-cols-5" : "grid-cols-1"}`}
      >
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
                  <div className="text-sm font-semibold">
                    Pace Shuttles Assistant
                  </div>
                  <div className="text-xs text-slate-500">
                    {pending ? "Thinking…" : isAuthed ? "Connected" : "Online"}
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
                  className={`flex ${
                    m.role === "assistant" ? "justify-start" : "justify-end"
                  }`}
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
                    <div className="text-xs text-slate-500">
                      Open ↔ Resolved ↔ Closed
                    </div>
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
                  {(["open", "resolved", "closed"] as TicketStatus[]).map(
                    (s) => (
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
                    )
                  )}
                </div>
              </div>

              {/* Ticket list */}
              <div className="max-h-[28vh] overflow-y-auto border-b border-slate-100">
                {ticketsLoading ? (
                  <div className="p-4 text-sm text-slate-600">
                    Loading tickets…
                  </div>
                ) : ticketsError ? (
                  <div className="p-4 text-sm text-red-600">{ticketsError}</div>
                ) : tickets.length === 0 ? (
                  <div className="p-4">
                    <div className="text-sm font-semibold text-slate-900">
                      No {humanStatus(ticketStatusFilter)} tickets
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      When tickets are raised, they’ll appear here with support
                      updates.
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
                  <div className="text-sm text-slate-600">
                    Loading conversation…
                  </div>
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

                    <div className="mt-3">
                      {replyError && (
                        <div className="text-sm text-red-600 mb-2">
                          {replyError}
                        </div>
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
                          disabled={
                            replySending || ticketDetail.ticket.status === "closed"
                          }
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
                      {ticketDetail.ticket.status === "closed" && (
                        <div className="mt-2 text-xs text-slate-500">
                          Closed tickets can’t be reopened. Please raise a new
                          ticket.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-500">
              “Resolved” tickets reopen automatically when you reply. “Closed”
              tickets are final.
            </div>
          </div>
        )}
      </div>

      {/* New Ticket Modal (logged-in only) */}
      {isAuthed && newOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (newBusy ? null : setNewOpen(false))}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Create a new ticket
                </div>
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
                <label className="text-xs font-medium text-slate-700">
                  Short title (optional)
                </label>
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
                <label className="text-xs font-medium text-slate-700">
                  What do you need help with? *
                </label>
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
                  <label className="text-xs font-medium text-slate-700">
                    Reference (optional)
                  </label>
                  <input
                    value={newRef}
                    onChange={(e) => setNewRef(e.target.value)}
                    placeholder="Booking #, journey, route…"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={newBusy}
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700">
                    Desired outcome (optional)
                  </label>
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
                onClick={createNewTicket}
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
