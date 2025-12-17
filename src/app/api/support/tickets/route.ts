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
type UserTicketStatus = "open" | "resolved" | "closed";

function mapUserStatus(zammadState: string): UserTicketStatus {
  if (zammadState === "pending close") return "resolved";
  if (zammadState === "closed") return "closed";
  return "open"; // "new", "open", etc.
}

/**
 * Map user-facing status -> Zammad states to query
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

/* ============================================================
   GET /api/support/tickets?status=open|resolved|closed
   ============================================================ */
export async function GET(req: Request) {
  try {
    const user = await requireUser(); // must throw AUTH_REQUIRED when not signed in
    const url = new URL(req.url);

    const statusParam = (url.searchParams.get("status") || "open") as UserTicketStatus;
    const status: UserTicketStatus =
      statusParam === "resolved" || statusParam === "closed" || statusParam === "open"
        ? statusParam
        : "open";

    // 1) Find Zammad customer user by email
    const userRes = await fetch(
      `${ZAMMAD_BASE}/users/search?query=${encodeURIComponent(user.email)}`,
      { headers: zammadHeaders() }
    );
    if (!userRes.ok) {
      return NextResponse.json(
        { ok: false, error: "ZAMMAD_USER_LOOKUP_FAILED", details: await userRes.text() },
        { status: 502 }
      );
    }

    const found = (await safeJson(userRes)) as any[];
    const zUser = Array.isArray(found)
      ? found.find((u) => String(u?.email || "").toLowerCase() === user.email.toLowerCase())
      : null;

    if (!zUser?.id) {
      // No Zammad customer record yet — return empty list (don’t treat as error)
      return NextResponse.json({ ok: true, tickets: [], status });
    }

    // 2) Pull tickets for that customer (and filter by state)
    const states = mapQueryStates(status);

    // Zammad supports search via /tickets/search
    // Query uses its search syntax; this works well on hosted instances.
    const query = `customer.id:${zUser.id} state:(${states.map((s) => `"${s}"`).join(" OR ")})`;
    const tRes = await fetch(
      `${ZAMMAD_BASE}/tickets/search?query=${encodeURIComponent(query)}`,
      { headers: zammadHeaders() }
    );

    if (!tRes.ok) {
      return NextResponse.json(
        { ok: false, error: "ZAMMAD_TICKET_SEARCH_FAILED", details: await tRes.text() },
        { status: 502 }
      );
    }

    const tickets = (await safeJson(tRes)) as any[];

    const shaped = (Array.isArray(tickets) ? tickets : []).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      userStatus: mapUserStatus(t.state),
      state: t.state,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      lastUpdatedAt: t.updated_at,
      // optional fields if you want them in UI:
      priorityId: t.priority_id,
      groupId: t.group_id,
    }));

    return NextResponse.json({ ok: true, tickets: shaped, status });
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
      userProvidedTitle ||
      message.split("\n").find(Boolean)?.slice(0, 80) ||
      "Support request";

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

        // your custom fields (as created in Zammad)
        ai_category: inferredCategory,
        ai_tone: inferredTone,

        // This route is “user created ticket”, not chat escalation:
        // keep blank or set something lightweight; you can add later.
        ai_escalation_reason: body?.ai_escalation_reason ?? "User created ticket from Support page.",
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
