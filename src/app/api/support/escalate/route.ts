// src/app/api/support/escalate/route.ts
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
 * Lightweight category inference (server-side).
 * Deterministic, safe. You can replace with an LLM later.
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
  ) return "Complaint";

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
  ) return "Incident";

  if (
    t.includes("operator") ||
    t.includes("list my boat") ||
    t.includes("list my helicopter") ||
    t.includes("become a partner") ||
    t.includes("add my vehicle") ||
    t.includes("commission") ||
    t.includes("onboard")
  ) return "Prospective Operator";

  if (
    t.includes("price") ||
    t.includes("availability") ||
    t.includes("book") ||
    t.includes("booking") ||
    t.includes("schedule") ||
    t.includes("where do you operate") ||
    t.includes("how much") ||
    t.includes("quote")
  ) return "Prospective Customer";

  if (
    t.includes("request") ||
    t.includes("feature") ||
    t.includes("can you add") ||
    t.includes("please add") ||
    t.includes("i want") ||
    t.includes("would like")
  ) return "Request";

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
  ) return "happy";

  if (
    t.includes("frustrat") ||
    t.includes("annoy") ||
    t.includes("angry") ||
    t.includes("unacceptable") ||
    t.includes("ridiculous") ||
    t.includes("still not") ||
    t.includes("doesn't work")
  ) return "frustrated";

  return "neutral";
}

function buildTranscript(messages: Array<{ role: string; content: string }>) {
  const lines: string[] = [];
  for (const m of messages || []) {
    const who =
      m.role === "user" ? "Customer" :
      m.role === "assistant" ? "Pace Shuttles Assistant" :
      String(m.role || "Unknown");
    const text = String(m.content || "").trim();
    if (!text) continue;
    lines.push(`${who}:\n${text}\n`);
  }
  return lines.join("\n");
}

/**
 * Keep summary <= 5 paragraphs (we enforce by splitting on blank lines
 * and trimming to 5 blocks; you can replace with your LLM summariser later)
 */
function clampToFiveParagraphs(summary: string) {
  const s = String(summary || "").trim();
  if (!s) return "";
  const blocks = s.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
  return blocks.slice(0, 5).join("\n\n");
}

/**
 * POST /api/support/escalate
 *
 * Body:
 * {
 *   title?: string,
 *   messages: [{ role: "user"|"assistant"|string, content: string }],
 *   userNote?: string,                  // optional extra text user wants to add
 *   aiSummary?: string,                 // optional (<=5 paragraphs ideally)
 *   aiFailureReason?: string,           // why the chat failed (agent-visible only)
 *   aiCategory?: ProvisionalCategory,   // optional override
 *   aiTone?: UserTone,                  // optional override
 *   escalationReason?: string,          // optional (system-trigger reason)
 *   group_id?: number
 * }
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    if (!messages.length) {
      return NextResponse.json(
        { ok: false, error: "MESSAGES_REQUIRED" },
        { status: 400 }
      );
    }

    const transcript = buildTranscript(messages);

    const userNote = typeof body?.userNote === "string" ? body.userNote.trim() : "";
    const providedTitle = typeof body?.title === "string" ? body.title.trim() : "";

    // Title: either provided, or first user line, or fallback
    const firstUserMsg =
      messages.find((m: any) => String(m?.role || "").toLowerCase() === "user")?.content ??
      "";
    const derivedTitle =
      providedTitle ||
      String(firstUserMsg || "").split("\n").find(Boolean)?.slice(0, 80) ||
      "Support request from chat";

    const escalationReason =
      typeof body?.escalationReason === "string" && body.escalationReason.trim()
        ? body.escalationReason.trim()
        : "Escalated from Pace Shuttles chat.";

    // Determine tone/category (allow overrides)
    const inferredCategory =
      (typeof body?.aiCategory === "string" && body.aiCategory) ||
      inferCategoryFromText(`${derivedTitle}\n${transcript}`);

    const inferredTone =
      (typeof body?.aiTone === "string" && body.aiTone) ||
      inferTone(`${derivedTitle}\n${transcript}`);

    const aiSummary = clampToFiveParagraphs(
      typeof body?.aiSummary === "string" ? body.aiSummary : ""
    );

    const aiFailureReason =
      typeof body?.aiFailureReason === "string" ? body.aiFailureReason.trim() : "";

    const groupId = Number(body?.group_id || 1);

    /**
     * 1) Create ticket with PUBLIC article containing transcript + user note
     *    (Customer-visible)
     */
    const publicBodyParts: string[] = [];
    if (userNote) {
      publicBodyParts.push("Customer note:\n" + userNote);
    }
    publicBodyParts.push("Chat transcript:\n" + transcript);

    const createRes = await fetch(`${ZAMMAD_BASE}/tickets`, {
      method: "POST",
      headers: zammadHeaders(),
      body: JSON.stringify({
        title: derivedTitle,
        group_id: groupId,
        customer: user.email,
        article: {
          subject: derivedTitle,
          body: publicBodyParts.join("\n\n---\n\n"),
          type: "note",
          internal: false,
        },

        // Your custom fields (as you created in Zammad)
        ai_category: inferredCategory,
        ai_tone: inferredTone,
        ai_escalation_reason: escalationReason,

        // If you ALSO created a custom field for failure reason, keep this line.
        // If not, harmless to omit — we’ll also write it as an internal note below.
        ...(aiFailureReason ? { ai_failure_reason: aiFailureReason } : {}),
      }),
    });

    if (!createRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "ZAMMAD_TICKET_CREATE_FAILED",
          details: await createRes.text(),
        },
        { status: 502 }
      );
    }

    const created = await createRes.json();
    const ticketId = created?.id as number | undefined;

    /**
     * 2) Add INTERNAL note for agents: escalation reason + failure reason + summary
     */
    const internalChunks: string[] = [];
    internalChunks.push("=== AI ESCALATION ===");
    internalChunks.push(`Reason: ${escalationReason}`);
    internalChunks.push(`Tone: ${inferredTone}`);
    internalChunks.push(`Provisional category: ${inferredCategory}`);
    if (aiFailureReason) {
      internalChunks.push("");
      internalChunks.push("=== WHY THE CHAT FAILED ===");
      internalChunks.push(aiFailureReason);
    }
    if (aiSummary) {
      internalChunks.push("");
      internalChunks.push("=== AI SUMMARY (<= 5 paragraphs) ===");
      internalChunks.push(aiSummary);
    }

    // Only write internal note if we have something beyond the header
    if (ticketId && internalChunks.join("\n").trim()) {
      const articleRes = await fetch(`${ZAMMAD_BASE}/ticket_articles`, {
        method: "POST",
        headers: zammadHeaders(),
        body: JSON.stringify({
          ticket_id: ticketId,
          subject: "AI Escalation Context (Internal)",
          body: internalChunks.join("\n"),
          type: "note",
          internal: true,
        }),
      });

      // Don’t fail the whole request if internal note fails
      if (!articleRes.ok) {
        // still return ok, but warn
        return NextResponse.json({
          ok: true,
          ticket: created,
          warning: "Ticket created, but failed to add internal escalation note.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ticket: created,
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
