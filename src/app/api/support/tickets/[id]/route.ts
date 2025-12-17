// src/app/api/support/tickets/[id]/route.ts

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import {
  ZAMMAD_BASE,
  zammadHeaders,
  mapUserStatusByStateId,
  getTicketCustomerEmail,
} from "@/lib/zammad";

function toISO(dt: any): string | null {
  if (!dt) return null;
  try {
    return new Date(dt).toISOString();
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser();
    const ticketId = Number(params.id);

    if (!ticketId || Number.isNaN(ticketId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TICKET_ID" },
        { status: 400 }
      );
    }

    // 1) Load ticket
    const ticketRes = await fetch(`${ZAMMAD_BASE}/tickets/${ticketId}`, {
      headers: zammadHeaders(),
    });

    if (!ticketRes.ok) {
      return NextResponse.json(
        { ok: false, error: await ticketRes.text() },
        { status: 502 }
      );
    }

    const ticket = await ticketRes.json();

    // Ownership check
    const email = await getTicketCustomerEmail(ticket);
    if (!email || email !== user.email.toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const stateId = Number(ticket?.state_id);
    const status = mapUserStatusByStateId(stateId);

    // 2) Load articles (conversation)
    const artRes = await fetch(
      `${ZAMMAD_BASE}/ticket_articles/by_ticket/${ticketId}`,
      { headers: zammadHeaders() }
    );

    if (!artRes.ok) {
      return NextResponse.json(
        { ok: false, error: await artRes.text() },
        { status: 502 }
      );
    }

    const articlesRaw = await artRes.json();
    const articles: any[] = Array.isArray(articlesRaw) ? articlesRaw : [];

    // Only customer-visible articles
    const publicThread = articles
      .filter((a) => a?.internal !== true)
      .map((a) => ({
        id: Number(a?.id),
        createdAt: toISO(a?.created_at),
        subject: String(a?.subject ?? ""),
        body: String(a?.body ?? ""),
        // Helpful for UI: show whether it came from Customer or Agent
        sender: String(a?.sender ?? ""),
        type: String(a?.type ?? "note"),
      }))
      .sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return ta - tb;
      });

    return NextResponse.json({
      ok: true,
      ticket: {
        id: Number(ticket?.id),
        number: String(ticket?.number ?? ""),
        title: String(ticket?.title ?? ""),
        status,
        createdAt: toISO(ticket?.created_at),
        updatedAt: toISO(ticket?.updated_at),
      },
      thread: publicThread,
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
