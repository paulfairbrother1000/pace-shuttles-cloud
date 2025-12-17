// src/app/api/support/tickets/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

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
 * Your Zammad group (Support). You already used group_id=1 in tests.
 * Keep 1 as default, but allow override via env.
 */
function supportGroupId(): number {
  const raw = process.env.ZAMMAD_SUPPORT_GROUP_ID;
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

type ProvisionalCategory =
  | "Prospective Customer"
  | "Prospective Operator"
  | "Complaint"
  | "Information"
  | "Incident"
  | "Request";

/**
 * Deterministic category classifier (no LLM dependency).
 * Tune keywords anytime without changing UI.
 */
function classifyCategory(text: string): { category: ProvisionalCategory; reason: string } {
  const t = text.toLowerCase();

  const hasAny = (words: string[]) => words.some((w) => t.includes(w));

  // Complaint
  if (hasAny(["complaint", "unhappy", "angry", "disappointed", "terrible", "awful", "refund", "compensation"])) {
    return { category: "Complaint", reason: "Detected complaint/refund sentiment keywords." };
  }

  // Incident (something broken / errors / payments failing)
  if (
    hasAny([
      "error",
      "bug",
      "broken",
      "not working",
      "doesn't work",
      "failed",
      "failure",
      "cannot",
      "can't",
      "stuck",
      "payment",
      "card",
      "checkout",
      "charge",
      "charged",
      "booking failed",
      "api",
      "500",
      "403",
      "401",
      "timeout",
    ])
  ) {
    return { category: "Incident", reason: "Detected operational failure / error keywords." };
  }

  // Prospective Operator
  if (
    hasAny([
      "become an operator",
      "list my boat",
      "list my helicopter",
      "partner",
      "supplier",
      "fleet",
      "operator admin",
      "commission",
      "onboarding",
      "integrate",
    ])
  ) {
    return { category: "Prospective Operator", reason: "Detected operator/onboarding keywords." };
  }

  // Prospective Customer (pre-booking questions)
  if (
    hasAny([
      "how much",
      "price",
      "availability",
      "schedule",
      "timetable",
      "route",
      "from",
      "to",
      "pickup",
      "destination",
      "luggage",
      "how do i book",
      "can i book",
    ])
  ) {
    return { category: "Prospective Customer", reason: "Detected pre-booking intent keywords." };
  }

  // Request (feature / change)
  if (hasAny(["feature", "enhancement", "would be great", "please add", "can you add", "request"])) {
    return { category: "Request", reason: "Detected feature/change request keywords." };
  }

  // Default: Information
  return { category: "Information", reason: "Defaulted to Information (no strong signals)." };
}

function buildTitle(inputTitle: string | null, body: string): string {
  const t = (inputTitle ?? "").trim();
  if (t) return t.slice(0, 120);

  // Derive from first line of body
  const firstLine = body
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)[0];

  return (firstLine ? firstLine : "Support request").slice(0, 120);
}

function buildPublicBody(payload: {
  message: string;
  reference?: string | null;
  desiredOutcome?: string | null;
}) {
  const parts: string[] = [];
  parts.push(payload.message.trim());

  if (payload.reference?.trim()) {
    parts.push(`\n\nReference:\n${payload.reference.trim()}`);
  }
  if (payload.desiredOutcome?.trim()) {
    parts.push(`\n\nDesired outcome:\n${payload.desiredOutcome.trim()}`);
  }
  return parts.join("");
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(); // must return { email: string, name?: string }
    const { title, message, reference, desiredOutcome } = (await req.json()) as {
      title?: string | null;
      message?: string;
      reference?: string | null;
      desiredOutcome?: string | null;
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ ok: false, error: "MESSAGE_REQUIRED" }, { status: 400 });
    }

    const publicBody = buildPublicBody({
      message,
      reference: reference ?? null,
      desiredOutcome: desiredOutcome ?? null,
    });

    const finalTitle = buildTitle(title ?? null, publicBody);

    const { category, reason } = classifyCategory(`${finalTitle}\n\n${publicBody}`);

    /**
     * 1) Create ticket (with public first article)
     */
    const createRes = await fetch(`${ZAMMAD_BASE}/tickets`, {
      method: "POST",
      headers: zammadHeaders(),
      body: JSON.stringify({
        title: finalTitle,
        group_id: supportGroupId(),
        customer: user.email,
        article: {
          subject: finalTitle,
          body: publicBody,
          type: "note",
          internal: false,
        },
        // custom fields you created (examples from your tests):
        ai_category: category,
        ai_tone: "neutral",
        ai_escalation_reason: "",
      }),
    });

    if (!createRes.ok) {
      return NextResponse.json({ ok: false, error: await createRes.text() }, { status: 502 });
    }

    const created = await createRes.json();

    /**
     * 2) Add agent-only internal note: why the category was chosen
     */
    try {
      await fetch(`${ZAMMAD_BASE}/ticket_articles`, {
        method: "POST",
        headers: zammadHeaders(),
        body: JSON.stringify({
          ticket_id: created.id,
          subject: "AI Classification (Internal)",
          body:
            `AI – Provisional Category: ${category}\n` +
            `Reason: ${reason}\n\n` +
            `Notes:\n- Title was ${title?.trim() ? "user-provided" : "derived from message"}.\n` +
            `- This is a user-created ticket (not an AI escalation).`,
          type: "note",
          internal: true,
        }),
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({
      ok: true,
      ticket: {
        id: created.id,
        number: created.number,
        title: created.title,
        status: created.state === "pending close" ? "resolved" : created.state === "closed" ? "closed" : "open",
      },
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: err?.message ?? "UNEXPECTED_ERROR" }, { status: 500 });
  }
}
