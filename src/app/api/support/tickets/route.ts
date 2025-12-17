// src/app/api/support/tickets/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

/**
 * Zammad configuration
 */
const ZAMMAD_BASE = "https://pace-shuttles-helpdesk.zammad.com/api/v1";

function zammadHeaders() {
  const token = process.env.ZAMMAD_API_TOKEN;
  if (!token) throw new Error("ZAMMAD_API_TOKEN is not set");
  return {
    Authorization: `Token token=${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Map Zammad state -> user-facing status
 */
export type UserTicketStatus = "open" | "resolved" | "closed";

function mapUserStatus(zammadStateRaw: string): UserTicketStatus {
  const z = String(zammadStateRaw || "").toLowerCase().trim();
  if (z === "pending close") return "resolved";
  if (z === "closed") return "closed";
  return "open"; // "new", "open", etc.
}

/**
 * Map user-facing status -> Zammad states to query (when you want to filter locally)
 */
function mapQueryStates(status: UserTicketStatus): string[] {
  if (status === "resolved") return ["pending close"];
  if (status === "closed") return ["closed"];
  return ["new", "open"];
}

/**
 * Lightweight category inference (server-side).
 * You can replace this later with an LLM classifier, but this is deterministic & safe.
 */
type ProvisionalCategory =
  | "Prospective Customer"
  | "Prospective Operator"
  | "Complaint"
  | "Information"
  | "Incident"
  | "Request";

function inferCategoryFromText(text: string): ProvisionalCategory {
  const t = text.toLowerCase();

  // Complaint / unhappy signals
  if (
    t.includes("complain") ||
    t.includes("unacceptable") ||
    t.includes("angry") ||
    t.includes("frustrat") ||
    t.includes("disappointed") ||
    t.includes("refund")
  ) {
    return "Complaint";
  }

  // Incident / broken / error
  if (
    t.includes("error") ||
    t.includes("bug") ||
    t.includes("broken") ||
    t.includes("failed") ||
    t.includes("not working") ||
    t.includes("can't") ||
    t.includes("cannot") ||
    t.includes("unable") ||
    t.includes("payment") ||
    t.includes("charged") ||
    t.includes("checkout")
  ) {
    return "Incident";
  }

  // Prospective operator
  if (
    t.includes("operator") ||
    t.includes("list my boat") ||
    t.includes("list my helicopter") ||
    t.includes("become a partner") ||
    t.includes("add my vehicle") ||
    t.includes("commission") ||
    t.includes("onboard")
  ) {
    return "Prospective Operator";
  }

  // Prospective customer
  if (
    t.includes("price") ||
    t.includes("availability") ||
    t.includes("book") ||
    t.includes("booking") ||
    t.includes("schedule") ||
    t.includes("where do you operate") ||
    t.includes("how much") ||
    t.includes("quote")
  ) {
    return "Prospective Customer";
  }

  // Request / feature / change
  if (
    t.includes("request") ||
    t.includes("feature") ||
    t.includes("can you add") ||
    t.includes("please add") ||
    t.includes("i want") ||
    t.includes("would like")
  ) {
    return "Request";
  }

  return "Information";
}

/**
 * Tone inference (kept simple & deterministic).
 * Your chat-driven escalation can override this later.
 */
type UserTone = "neutral" | "frustrated" | "happy";
function inferTone(text: string): UserTone {
  const t = text.toLowerCase();
  if (
    t.includes("thanks") ||
    t.includes("great") ||
    t.includes("brilliant") ||
    t.includes("love") ||
    t.includes("perfect")
  )
    return "happy";
  if (
    t.includes("frustrat") ||
    t.includes("annoy") ||
    t.includes("angry") ||
    t.includes("unacceptable") ||
    t.includes("ridiculous") ||
    t.includes("still not") ||
    t.includes("doesn't work")
  )
    return "frustrated";
  return "neutral";
}

/**
 * Utility: safe JSON parse for Zammad responses (sometimes returns empty)
 */
async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return txt ? JSON.parse(txt) : null;
  } catch {
    return { _raw: txt };
  }
}

/**
 * Zammad sometimes returns `state_id` (number) rather than `state` (string).
 * Build a map id -> name so we can reliably classify tickets.
 */
type TicketStateRow = { id: number; name: string };

async function fetchTicketStateMap(): Promise<Record<number, string>> {
  const res = await fetch(`${ZAMMAD_BASE}/ticket_states`, {
    headers: zammadHeaders(),
  });
  if (!res.ok) return {};
  const rows = (await res.json()) as TicketStateRow[];
  const map: Record<number, string> = {};
  for (const r of rows || []) {
    if (typeof r?.id === "number" && typeof r?.name === "string") {
      map[r.id] = r.name;
    }
  }
  return map;
}

function resolveZammadStateName(
  ticket: any,
  stateMap: Record<number, string>
): string {
  // Prefer explicit state string if present; else resolve from state_id.
  const direct = ticket?.state;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const id = ticket?.state_id;
  if (typeof id === "number" && stateMap[id]) return stateMap[id];

  // Some Zammad payloads may use `stateId` etc; be defensive.
  const altId = ticket?.stateId ?? ticket?.stateID;
  if (typeof altId === "number" && stateMap[altId]) return stateMap[altId];

  return "";
}

/* ============================================================
   GET /api/support/tickets?status=open|resolved|closed
   ============================================================ */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    const statusParam = (url.searchParams.get("status") || "open") as UserTicketStatus;

    // 0) Pull ticket state map (id->name) so we classify correctly even if Zammad only returns state_id
    const stateMap = await fetchTicketStateMap();

    // 1) Find Zammad user (by email)
    const userRes = await fetch(
      `${ZAMMAD_BASE}/users/search?query=${encodeURIComponent(user.email)}`,
      { headers: zammadHeaders() }
    );

    if (!userRes.ok) {
      return NextResponse.json(
        { ok: false, error: "ZAMMAD_USER_LOOKUP_FAILED" },
        { status: 502 }
      );
    }

    const users = (await userRes.json()) as any[];
    const zUser = (users || []).find(
      (u) => String(u?.email || "").toLowerCase() === user.email.toLowerCase()
    );

    if (!zUser?.id) {
      return NextResponse.json({ ok: true, tickets: [], status: statusParam });
    }

    // 2) Fetch tickets for that customer
    // NOTE: Zammad returns `state_id` on this endpoint in many cases.
    const ticketsRes = await fetch(`${ZAMMAD_BASE}/tickets?customer_id=${zUser.id}`, {
      headers: zammadHeaders(),
    });

    if (!ticketsRes.ok) {
      return NextResponse.json(
        { ok: false, error: "ZAMMAD_TICKET_FETCH_FAILED", details: await ticketsRes.text() },
        { status: 502 }
      );
    }

    const tickets = (await ticketsRes.json()) as any[];

    // 3) Map + filter using *resolved* state name
    const mapped = (tickets || []).map((t) => {
      const zammadStateName = resolveZammadStateName(t, stateMap);
      const userStatus = mapUserStatus(zammadStateName);

      return {
        id: t.id,
        number: t.number,
        title: t.title,
        // keep both for debugging/UI
        state: zammadStateName || t.state || null,
        state_id: typeof t.state_id === "number" ? t.state_id : null,
        userStatus,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };
    });

    const desiredZammadStates = mapQueryStates(statusParam).map((s) => s.toLowerCase());

    const filtered = mapped.filter((t) => {
      // Primary filter: our normalized userStatus (because we define "resolved" as pending close)
      if (t.userStatus !== statusParam) return false;

      // Secondary safety: ensure the underlying Zammad state aligns with what we expect
      // (prevents weird mis-classification from leaking tickets into wrong tab).
      const z = String(t.state || "").toLowerCase();
      if (!z) return false;
      return desiredZammadStates.includes(z);
    });

    return NextResponse.json({
      ok: true,
      tickets: filtered,
      status: statusParam,
      // helpful for debugging without exposing sensitive info:
      meta: {
        totalFetched: mapped.length,
        totalReturned: filtered.length,
      },
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: err?.message ?? "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}

/* ============================================================
   POST /api/support/tickets
   Create a new ticket (support page “New ticket”)
   ============================================================ */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const userProvidedTitle = typeof body?.title === "string" ? body.title.trim() : "";

    if (!message) {
      return NextResponse.json({ ok: false, error: "MESSAGE_REQUIRED" }, { status: 400 });
    }

    // Derive title + category if not provided
    const derivedTitle =
      userProvidedTitle || message.split("\n").find(Boolean)?.slice(0, 80) || "Support request";

    const inferredCategory = inferCategoryFromText(`${derivedTitle}\n${message}`);
    const inferredTone = inferTone(`${derivedTitle}\n${message}`);

    // You’ve been using group_id = 1 in your tests (Pace Shuttles Support)
    const groupId = Number(body?.group_id || 1);

    const createRes = await fetch(`${ZAMMAD_BASE}/tickets`, {
      method: "POST",
      headers: zammadHeaders(),
      body: JSON.stringify({
        title: derivedTitle,
        group_id: groupId,
        customer: user.email,
        article: {
          subject: derivedTitle,
          body: message,
          type: "note",
          internal: false, // customer-visible
        },

        // custom fields (as created in Zammad)
        ai_category: inferredCategory,
        ai_tone: inferredTone,

        // Support-page created ticket (not chat escalation)
        ai_escalation_reason:
          body?.ai_escalation_reason ?? "User created ticket from Support page.",
      }),
    });

    if (!createRes.ok) {
      return NextResponse.json(
        { ok: false, error: "ZAMMAD_TICKET_CREATE_FAILED", details: await createRes.text() },
        { status: 502 }
      );
    }

    const ticket = await safeJson(createRes);

    return NextResponse.json({
      ok: true,
      ticket,
      derived: {
        title: derivedTitle,
        ai_category: inferredCategory,
        ai_tone: inferredTone,
      },
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json(
      { ok: false, error: err?.message ?? "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}
