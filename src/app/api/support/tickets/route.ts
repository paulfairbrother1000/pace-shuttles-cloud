import { NextResponse } from "next/server";

const ZAMMAD_BASE = "https://pace-shuttles-helpdesk.zammad.com/api/v1";
const GROUP_ID = 1;

function zammadAuthHeader() {
  const token = process.env.ZAMMAD_API_TOKEN;
  if (!token) throw new Error("Missing ZAMMAD_API_TOKEN env var");
  return { Authorization: `Token token=${token}` };
}

export async function POST(req: Request) {
  try {
    const {
      subject,
      publicDescription,
      aiSummary,
      escalationReason,
      tone,
      category,
      transcript,
      user, // { email, firstname, lastname }
    } = await req.json();

    if (!user?.email) {
      return NextResponse.json({ ok: false, error: "Missing user.email" }, { status: 400 });
    }
    if (!subject || !publicDescription) {
      return NextResponse.json({ ok: false, error: "Missing subject/publicDescription" }, { status: 400 });
    }

    // 1) Create ticket (with your custom fields)
    const createRes = await fetch(`${ZAMMAD_BASE}/tickets`, {
      method: "POST",
      headers: {
        ...zammadAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: subject,
        group_id: GROUP_ID,
        customer: user.email,
        article: {
          subject,
          body: publicDescription,
          type: "note",
          internal: false,
        },

        // Custom fields you created:
        ai_tone: tone ?? "neutral",
        ai_category: category ?? "Information",
        ai_escalation_reason: escalationReason ?? "",
      }),
    });

    const createText = await createRes.text();
    if (!createRes.ok) {
      return NextResponse.json(
        { ok: false, error: "Zammad ticket create failed", details: createText },
        { status: 502 }
      );
    }

    const ticket = JSON.parse(createText) as { id: number; number: string };

    // 2) Add internal note (agent-only)
    const internalBody = [
      "=== AI ESCALATION REASON ===",
      escalationReason || "(not provided)",
      "",
      "=== AI SUMMARY (<=5 paragraphs) ===",
      aiSummary || "(not provided)",
      "",
      "=== FULL AI TRANSCRIPT ===",
      transcript || "(not provided)",
    ].join("\n");

    const noteRes = await fetch(`${ZAMMAD_BASE}/ticket_articles`, {
      method: "POST",
      headers: {
        ...zammadAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ticket_id: ticket.id,
        subject: "AI Escalation Context (Internal)",
        body: internalBody,
        type: "note",
        internal: true,
      }),
    });

    // If internal note fails, we still return the ticket id (but flag it)
    if (!noteRes.ok) {
      const noteErr = await noteRes.text();
      return NextResponse.json({
        ok: true,
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        internalNoteOk: false,
        internalNoteError: noteErr,
      });
    }

    return NextResponse.json({
      ok: true,
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      internalNoteOk: true,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
