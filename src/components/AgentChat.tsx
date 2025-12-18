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
/*  Transcript + escalation helpers                                            */
/* -------------------------------------------------------------------------- */

function isHumanRequest(text: string) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("human") ||
    t.includes("agent") ||
    t.includes("live agent") ||
    t.includes("representative") ||
    t.includes("person") ||
    t.includes("someone") ||
    t.includes("speak to a human") ||
    t.includes("talk to a human")
  );
}

function inferProvisionalCategoryFromTranscript(transcript: string) {
  const t = transcript.toLowerCase();

  // booking/availability/price => Prospective Customer (most important rule)
  if (
    t.includes("book") ||
    t.includes("booking") ||
    t.includes("availability") ||
    t.includes("price") ||
    t.includes("how much") ||
    t.includes("quote") ||
    t.includes("journey") ||
    t.includes("schedule")
  ) {
    return "Prospective Customer";
  }

  if (
    t.includes("operator") ||
    t.includes("list my boat") ||
    t.includes("become a partner") ||
    t.includes("commission") ||
    t.includes("onboard")
  ) {
    return "Prospective Operator";
  }

  if (
    t.includes("error") ||
    t.includes("bug") ||
    t.includes("broken") ||
    t.includes("failed") ||
    t.includes("not working") ||
    t.includes("payment") ||
    t.includes("charged") ||
    t.includes("checkout")
  ) {
    return "Incident";
  }

  if (
    t.includes("complain") ||
    t.includes("unacceptable") ||
    t.includes("angry") ||
    t.includes("frustrat") ||
    t.includes("refund")
  ) {
    return "Complaint";
  }

  if (
    t.includes("request") ||
    t.includes("feature") ||
    t.includes("please add") ||
    t.includes("can you add")
  ) {
    return "Request";
  }

  return "Information";
}

function buildTranscript(messages: AgentMessage[], userEmail: string | null) {
  const header = [
    "Transcript (Pace Shuttles Assistant)",
    `User: ${userEmail ?? "Anonymous"}`,
    "",
  ].join("\n");

  const lines: string[] = [];

  for (const m of messages) {
    const role =
      m.role === "assistant" ? "Assistant" : m.role === "user" ? "User" : "System";

    // Only include the plain content (payload/actions are internal)
    const content = (m.content || "").trim();
    if (!content) continue;

    lines.push(`${role}: ${content}`);
    lines.push(""); // spacing
  }

  return header + lines.join("\n").trim();
}

/**
 * Convert HTML-ish content from Zammad into readable plain text for the client UI.
 * - Converts <br> and <div> to newlines
 * - Strips other tags
 */
function htmlToText(input: string) {
  const raw = input ?? "";
  if (!raw) return "";

  // Fast path: no tags
  if (!/[<>]/.test(raw)) return raw;

  // Replace common break tags with newlines before stripping
  const withBreaks = raw
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\s*div[^>]*>/gi, "")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\s*\/p\s*>/gi, "\n");

  // Strip remaining tags
  const stripped = withBreaks.replace(/<[^>]*>/g, "");

  // Decode basic entities (good enough for our use)
  return stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*  Zammad widget loader                                                      */
/* -------------------------------------------------------------------------- */

// ✅ NEW: explicit host constants so the widget never tries to auto-detect “undefined”
const ZAMMAD_HOST = "https://pace-shuttles-helpdesk.zammad.com";
const ZAMMAD_CHAT_ID = 1;

// Keep script src derived from host
const ZAMMAD_WIDGET_SRC = `${ZAMMAD_HOST}/assets/chat/chat-no-jquery.min.js`;

declare global {
  interface Window {
    ZammadChat?: any;
  }
}

// ✅ NEW: a safer loader that resolves if script already loaded + waits for window.ZammadChat
async function ensureZammadWidgetLoaded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.ZammadChat) return;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${ZAMMAD_WIDGET_SRC}"]`
    ) as HTMLScriptElement | null;

    if (existing) {
      // If it already loaded, resolve immediately
      if ((existing as any).dataset?.loaded === "1") return resolve();

      existing.addEventListener("load", () => {
        (existing as any).dataset.loaded = "1";
        resolve();
      });
      existing.addEventListener("error", () =>
        reject(new Error("Zammad script failed"))
      );

      // In some browsers the script may already be complete
      if ((existing as any).readyState === "complete") {
        (existing as any).dataset.loaded = "1";
        resolve();
      }
      return;
    }

    const s = document.createElement("script");
    s.src = ZAMMAD_WIDGET_SRC;
    s.async = true;
    s.onload = () => {
      (s as any).dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("Zammad script failed"));
    document.head.appendChild(s);
  });

  // Give the script a tick to populate window.ZammadChat
  if (!window.ZammadChat) {
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!window.ZammadChat) {
    throw new Error("ZammadChat did not initialise (window.ZammadChat missing).");
  }
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

    // Clear any pending escalation session
    if (typeof window !== "undefined") {
      localStorage.removeItem("ps_support_pending_human");
      localStorage.removeItem("ps_support_pending_choice");
    }

    // Reset escalation UI
    setEscalation({ stage: "none" });
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

  /* ------------------------------------------------------------------------ */
  /* Escalation state machine (UI-driven, so the LLM cannot refuse)           */
  /* ------------------------------------------------------------------------ */

  type EscalationStage =
    | "none"
    | "offer_human"
    | "ticket_compose"
    | "opening_live_chat";

  type EscalationState =
    | { stage: "none" }
    | { stage: "offer_human" }
    | { stage: "ticket_compose" }
    | {
        stage: "opening_live_chat";
        status: "loading" | "ready" | "error";
        error?: string;
      };

  const [escalation, setEscalation] = useState<EscalationState>({
    stage: "none",
  });

  // Ticket-from-chat modal state
  const [escTicketOpen, setEscTicketOpen] = useState(false);
  const [escTicketTitle, setEscTicketTitle] = useState("");
  const [escTicketAsk, setEscTicketAsk] = useState("");
  const [escTicketErr, setEscTicketErr] = useState<string | null>(null);
  const [escTicketBusy, setEscTicketBusy] = useState(false);

  // Zammad live chat modal state (we open widget + show helper UI)
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const zammadInitRef = useRef(false);
  const openZammadBtnRef = useRef<HTMLButtonElement | null>(null);

  function appendUserMessage(text: string) {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
  }

  function appendAssistantMessage(text: string) {
    setMessages((prev) => [...prev, { role: "assistant", content: text }]);
  }

  function handleSend(msg: string) {
    if (!msg.trim()) return;

    const userText = msg.trim();

    // Always record what the user said
    const newMessages = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);

    // If they ask for a human, we intercept and run escalation UI
    if (isHumanRequest(userText)) {
      // Persist “pending human” if they are anon — so after login we continue
      if (typeof window !== "undefined") {
        localStorage.setItem("ps_support_pending_human", "1");
      }

      if (!isAuthed) {
        appendAssistantMessage(
          "I can get a human to help — you’ll just need to sign in first. Use the Login button in the header, or tap the button below."
        );
        setEscalation({ stage: "none" });
        return;
      }

      appendAssistantMessage(
        "Would you like to contact a live agent? If no one is available, I can raise a ticket and an agent will get back to you — with the full transcript."
      );
      setEscalation({ stage: "offer_human" });
      return;
    }

    // Normal flow: call the AI agent
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
  const authedEmail = auth.status === "authed" ? auth.email : null;

  // After login: if we had a pending human request, continue to the next step
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isAuthed) return;

    const pendingHuman =
      localStorage.getItem("ps_support_pending_human") === "1";
    if (!pendingHuman) return;

    // Clear flag and continue
    localStorage.removeItem("ps_support_pending_human");

    appendAssistantMessage(
      "You’re signed in — would you like to contact a live agent now? If no one is available, I can raise a ticket with the full transcript."
    );
    setEscalation({ stage: "offer_human" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed]);

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

  // New ticket modal state (support panel)
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

      // sanitize bodies for client display (remove <br>, <div>, etc)
      const thread = (data.thread ?? []).map((a: any) => ({
        ...a,
        body: htmlToText(String(a?.body ?? "")),
      }));

      setTicketDetail({ ticket: data.ticket, thread });
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
      const res = await fetch(
        `/api/support/tickets/${selectedTicketId}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: msg }),
        }
      );
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.message ?? data?.error ?? "Failed to send reply"
        );
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

  /* ------------------------------------------------------------------------ */
  /* Escalation actions                                                       */
  /* ------------------------------------------------------------------------ */

  const transcript = useMemo(
    () => buildTranscript(messages, authedEmail),
    [messages, authedEmail]
  );

  async function startLiveAgent() {
    if (!isAuthed) {
      appendAssistantMessage(
        "To contact a human, you’ll need to sign in first. Use the Login button in the header, or tap the button below."
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("ps_support_pending_human", "1");
      }
      return;
    }

    // Record the user's choice in transcript
    appendUserMessage("Yes — contact a live agent");

    setEscalation({ stage: "opening_live_chat", status: "loading" });
    setLiveErr(null);
    setLiveBusy(true);
    setLiveOpen(true);

    try {
      await ensureZammadWidgetLoaded();

      // Init widget only once per page load
      if (
        !zammadInitRef.current &&
        typeof window !== "undefined" &&
        window.ZammadChat
      ) {
        zammadInitRef.current = true;

        // Manual open mode. We'll programmatically click a hidden open button.
        new window.ZammadChat({
          chatId: ZAMMAD_CHAT_ID,
          show: false,
          host: ZAMMAD_HOST, // ✅ keep host explicit to avoid “undefined”
          debug: true, // ✅ tells you why it isn’t showing (console)
        });
      }

      // Open it
      setTimeout(() => {
        openZammadBtnRef.current?.click();
      }, 50);

      setEscalation({ stage: "opening_live_chat", status: "ready" });
      appendAssistantMessage(
        "Connecting you to a live agent now (if one is available). If the live chat doesn’t open, I can raise a ticket with the full transcript."
      );
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load live chat";
      setLiveErr(msg);
      setEscalation({ stage: "opening_live_chat", status: "error", error: msg });
      appendAssistantMessage(
        "I couldn’t open live chat right now. Would you like me to raise a ticket for a human agent instead (with the full transcript)?"
      );
    } finally {
      setLiveBusy(false);
    }
  }

  function continueChat() {
    appendUserMessage("No — continue chatting");
    setEscalation({ stage: "none" });
    appendAssistantMessage(
      "No problem — we’ll keep going here. What would you like to do next?"
    );
  }

  function openTicketCompose() {
    if (!isAuthed) {
      appendAssistantMessage(
        "To raise a ticket for a human agent, you’ll need to sign in first. Use the Login button in the header, or tap the button below."
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("ps_support_pending_human", "1");
      }
      return;
    }

    appendUserMessage("No — raise a ticket instead");
    setEscalation({ stage: "ticket_compose" });

    // Open compose modal
    setEscTicketErr(null);
    setEscTicketTitle("");
    setEscTicketAsk("");
    setEscTicketOpen(true);
  }

  async function submitEscalationTicket() {
    setEscTicketErr(null);

    const ask = escTicketAsk.trim();
    if (!ask) {
      setEscTicketErr("Please tell the human agent what you want help with.");
      return;
    }

    const finalTranscript = transcript;
    const categoryHint = inferProvisionalCategoryFromTranscript(finalTranscript);

    // If user leaves title blank, we allow server to derive it; but we can provide a better hint
    const titleHint =
      escTicketTitle.trim() ||
      (ask.length > 80 ? ask.slice(0, 80) : ask) ||
      "Support request";

    const messageToSend =
      `User request for a human agent:\n${ask}\n\n` +
      `---\nFull transcript (Pace Shuttles Assistant):\n${finalTranscript}\n`;

    setEscTicketBusy(true);
    try {
      const res = await fetch(`/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // server may ignore these extras safely; existing route should not break
          title: titleHint,
          message: messageToSend, // ALWAYS non-empty => avoids MESSAGE_REQUIRED
          ai_escalation_reason: "User requested a human from chat escalation flow.",
          provisional_category_hint: categoryHint,
          source: "chat_escalation",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(
          data?.error ?? data?.details ?? "Failed to create ticket"
        );
      }

      const ticketNumber =
        data.ticket?.number ?? data.ticket?.ticket?.number ?? null;

      setEscTicketOpen(false);
      setEscTicketTitle("");
      setEscTicketAsk("");

      setTicketStatusFilter("open");
      await loadTickets("open");

      const createdId = data.ticket?.id as number | undefined;
      if (createdId) {
        setSelectedTicketId(createdId);
        await loadTicketDetail(createdId);
      }

      appendAssistantMessage(
        ticketNumber
          ? `Done — I’ve raised a ticket for a human agent. Ticket #${ticketNumber}.`
          : `Done — I’ve raised a ticket for a human agent.`
      );

      setEscalation({ stage: "none" });
    } catch (e: any) {
      setEscTicketErr(e?.message ?? "Failed to create ticket");
    } finally {
      setEscTicketBusy(false);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      {/* Hidden Zammad open button (manual open mode) */}
      <button
        ref={openZammadBtnRef}
        className="open-zammad-chat"
        style={{ display: "none" }}
        type="button"
      >
        Open Zammad Chat
      </button>

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

              {/* Escalation controls (appear after we offered) */}
              {escalation.stage === "offer_human" && (
                <div className="rounded-2xl ring-1 ring-slate-200 bg-white p-4">
                  {!isAuthed ? (
                    <>
                      <div className="text-sm text-slate-700">
                        You’ll need to sign in to contact a human agent.
                      </div>
                      <div className="mt-3 flex gap-2">
                        <a
                          href="/login"
                          className="inline-flex items-center justify-center rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
                        >
                          Login
                        </a>
                        <button
                          type="button"
                          onClick={continueChat}
                          className="rounded-xl ring-1 ring-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
                        >
                          Continue chatting
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={startLiveAgent}
                          className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
                          disabled={pending}
                        >
                          Yes — contact a live agent
                        </button>
                        <button
                          type="button"
                          onClick={openTicketCompose}
                          className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700"
                          disabled={pending}
                        >
                          No — raise a ticket instead
                        </button>
                        <button
                          type="button"
                          onClick={continueChat}
                          className="rounded-xl ring-1 ring-slate-200 px-4 py-2 text-sm hover:bg-slate-50"
                          disabled={pending}
                        >
                          No — continue chatting
                        </button>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        If live agents aren’t available, raising a ticket includes
                        the full transcript.
                      </div>
                    </>
                  )}
                </div>
              )}

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
                              #{t.number} • Updated {fmtDateTime(t.updatedAt)}
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
                            replySending ||
                            ticketDetail.ticket.status === "closed"
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

      {/* Live agent modal (Zammad widget opens) */}
      {liveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (liveBusy ? null : setLiveOpen(false))}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Live chat with support
                </div>
                <div className="text-xs text-slate-500">
                  If an agent is online, the chat widget will open.
                </div>
              </div>
              <button
                onClick={() => (liveBusy ? null : setLiveOpen(false))}
                className="text-slate-500 hover:text-slate-900 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {liveErr ? (
                <div className="text-sm text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl px-3 py-2">
                  {liveErr}
                </div>
              ) : (
                <div className="text-sm text-slate-700">
                  If the live chat doesn’t appear, it usually means no agents are
                  online. You can raise a ticket instead and we’ll include the
                  full transcript.
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={openTicketCompose}
                  className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-60"
                  disabled={liveBusy}
                >
                  Raise a ticket instead
                </button>
                <button
                  type="button"
                  onClick={() => setLiveOpen(false)}
                  className="rounded-xl ring-1 ring-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                  disabled={liveBusy}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ticket-from-chat escalation modal */}
      {isAuthed && escTicketOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => (escTicketBusy ? null : setEscTicketOpen(false))}
          />
          <div className="relative w-full max-w-xl rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Raise a ticket for a human agent
                </div>
                <div className="text-xs text-slate-500">
                  Tell us what you want help with — we’ll attach the full
                  transcript.
                </div>
              </div>
              <button
                onClick={() => (escTicketBusy ? null : setEscTicketOpen(false))}
                className="text-slate-500 hover:text-slate-900 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              {escTicketErr && (
                <div className="text-sm text-red-600 bg-red-50 ring-1 ring-red-200 rounded-xl px-3 py-2">
                  {escTicketErr}
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-slate-700">
                  Ticket title (optional)
                </label>
                <input
                  value={escTicketTitle}
                  onChange={(e) => setEscTicketTitle(e.target.value)}
                  placeholder="e.g. Help booking a journey to Nobu in December"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={escTicketBusy}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">
                  What would you like the human agent to help with? *
                </label>
                <textarea
                  value={escTicketAsk}
                  onChange={(e) => setEscTicketAsk(e.target.value)}
                  placeholder="Write exactly what you want to ask or resolve."
                  className="mt-1 w-full min-h-[120px] rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={escTicketBusy}
                />
              </div>

              <details className="rounded-xl ring-1 ring-slate-200 bg-slate-50 p-3">
                <summary className="text-sm cursor-pointer select-none text-slate-700">
                  Preview transcript that will be sent
                </summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">
                  {transcript}
                </pre>
              </details>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                onClick={() => (escTicketBusy ? null : setEscTicketOpen(false))}
                className="text-sm rounded-xl px-4 py-2 ring-1 ring-slate-200 hover:bg-slate-50"
                disabled={escTicketBusy}
              >
                Cancel
              </button>
              <button
                onClick={submitEscalationTicket}
                className="text-sm rounded-xl px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                disabled={escTicketBusy}
              >
                {escTicketBusy ? "Raising…" : "Raise ticket"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Ticket Modal (support panel) */}
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
                  Tell us what happened — we’ll route it to the right support
                  team.
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
                  If you leave this blank, we’ll create a helpful title
                  automatically.
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
