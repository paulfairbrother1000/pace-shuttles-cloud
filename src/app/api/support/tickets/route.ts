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
  const direct = ticket?.state;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const id = ticket?.state_id;
  if (typeof id === "number" && stateMap[id]) return stateMap[id];

  const altId = ticket?.stateId ?? ticket?.stateID;
  if (typeof altId === "number" && stateMap[altId]) return stateMap[altId];

  return "";
}

/**
 * Group defaulting:
 * - allow override by env
 * - otherwise default to 2 (your real group: "Pace Shuttles Support")
 */
function defaultGroupId(): number {
  const raw = process.env.ZAMMAD_DEFAULT_GROUP_ID;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return 2;
}

/**
 * Best-effort: Try creating with optional custom_fields; if Zammad rejects
 * (common if custom fields aren't configured), retry without custom_fields.
 */
async function createTicketWithFallback(payload: any) {
  const first = await fetch(`${ZAMMAD_BASE}/tickets`, {
    method: "POST",
    headers: zammadHeaders(),
    body: JSON.stringify(payload),
  });

  if (first.ok) return { ok: true as const, res: first };

  const firstText = await first.text();

  // Retry on common validation/attribute failures (400/422).
  if (first.status === 400 || first.status === 422) {
    const stripped = { ...payload };
    delete stripped.custom_fields;

    const second = await fetch(`${ZAMMAD_BASE}/tickets`, {
      method: "POST",
      headers: zammadHeaders(),
      body: JSON.stringify(stripped),
    });

    if (second.ok) return { ok: true as const, res: second };

    const secondText = await second.text();
    return {
      ok: false as const,
      status: second.status,
      details: `First attempt (${first.status}): ${firstText}\nSecond attempt (${second.status}): ${secondText}`,
    };
  }

  return {
    ok: false as const,
    status: first.status,
    details: firstText,
  };
}

/* ============================================================
   GET /api/support/tickets?status=open|resolved|closed
   ============================================================ */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    const statusParam = (url.searchParams.get("status") ||
      "open") as UserTicketStatus;

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
    const ticketsRes = await fetch(
      `${ZAMMAD_BASE}/tickets?customer_id=${zUser.id}`,
      { headers: zammadHeaders() }
    );

    if (!ticketsRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ZAMMAD_TICKET_FETCH_FAILED",
          details: await ticketsRes.text(),
        },
        { status: 502 }
      );
    }

    const tickets = (await ticketsRes.json()) as any[];

    const mapped = (tickets || []).map((t) => {
      const zammadStateName = resolveZammadStateName(t, stateMap);
      const status = mapUserStatus(zammadStateName);

      return {
        id: t.id,
        number: t.number,
        title: t.title,
        status,
        state: zammadStateName || t.state || null,
        state_id: typeof t.state_id === "number" ? t.state_id : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };
    });

    const desiredZammadStates = mapQueryStates(statusParam).map((s) =>
      s.toLowerCase()
    );

    const filtered = mapped.filter((t) => {
      if (t.status !== statusParam) return false;
      const z = String(t.state || "").toLowerCase();
      if (!z) return false;
      return desiredZammadStates.includes(z);
    });

    return NextResponse.json({
      ok: true,
      tickets: filtered,
      status: statusParam,
      meta: {
        totalFetched: mapped.length,
        totalReturned: filtered.length,
      },
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED" },
        { status: 401 }
      );
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
    const userProvidedTitle =
      typeof body?.title === "string" ? body.title.trim() : "";

    const reference =
      typeof body?.reference === "string" ? body.reference.trim() : "";
    const desiredOutcome =
      typeof body?.desiredOutcome === "string" ? body.desiredOutcome.trim() : "";

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "MESSAGE_REQUIRED" },
        { status: 400 }
      );
    }

    const derivedTitle =
      userProvidedTitle ||
      message.split("\n").find(Boolean)?.slice(0, 80) ||
      "Support request";

    const inferredCategory = inferCategoryFromText(
      `${derivedTitle}\n${message}`
    );
    const inferredTone = inferTone(`${derivedTitle}\n${message}`);

    // IMPORTANT: default to your real support group (id=2)
    const groupIdRaw = body?.group_id;
    const groupId =
      Number.isFinite(Number(groupIdRaw)) && Number(groupIdRaw) > 0
        ? Number(groupIdRaw)
        : defaultGroupId();

    // Put reference/outcome into the body so we don't rely on custom fields existing
    const bodyParts = [message];
    if (reference) bodyParts.push(`\nReference: ${reference}`);
    if (desiredOutcome) bodyParts.push(`\nDesired outcome: ${desiredOutcome}`);
    const finalBody = bodyParts.join("\n").trim();

    // ✅ Valid Zammad payload
    // IMPORTANT FIX:
    // Use article.type="note" (customer-visible) so Zammad does NOT require an email recipient.
    const payload: any = {
      title: derivedTitle,
      group_id: groupId,
      customer: user.email,
      article: {
        subject: derivedTitle,
        body: finalBody,
        type: "note",
        internal: false,
      },

      // Optional: only works if these custom fields exist in Zammad
      // (we fallback if Zammad rejects)
      custom_fields: {
        ai_category: inferredCategory,
        ai_tone: inferredTone,
        ai_escalation_reason:
          typeof body?.ai_escalation_reason === "string" &&
          body.ai_escalation_reason.trim()
            ? body.ai_escalation_reason.trim()
            : "User created ticket from Support page.",
        provisional_category_hint:
          typeof body?.provisional_category_hint === "string" &&
          body.provisional_category_hint.trim()
            ? body.provisional_category_hint.trim()
            : undefined,
        source:
          typeof body?.source === "string" && body.source.trim()
            ? body.source.trim()
            : undefined,
      },
    };

    // Remove undefined keys inside custom_fields (keeps payload clean)
    if (payload.custom_fields) {
      for (const k of Object.keys(payload.custom_fields)) {
        if (payload.custom_fields[k] === undefined)
          delete payload.custom_fields[k];
      }
      if (Object.keys(payload.custom_fields).length === 0) {
        delete payload.custom_fields;
      }
    }

    const create = await createTicketWithFallback(payload);

    if (!create.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ZAMMAD_TICKET_CREATE_FAILED",
          status: create.status,
          details: create.details,
        },
        { status: 502 }
      );
    }

    const ticket = await safeJson(create.res);

    return NextResponse.json({
      ok: true,
      ticket,
      derived: {
        title: derivedTitle,
        ai_category: inferredCategory,
        ai_tone: inferredTone,
        group_id: groupId,
      },
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { ok: false, error: err?.message ?? "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}
