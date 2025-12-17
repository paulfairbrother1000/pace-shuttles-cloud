// src/app/api/support/tickets/[id]/reply/route.ts

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
 * Map Zammad state → user-facing status (Zammad Cloud)
 * - pending close = Resolved
 * - closed = Closed
 * - new/open = Open
 */
function mapUserStatus(zammadState: string): "open" | "resolved" | "closed" {
  if (zammadState === "pending close") return "resolved";
  if (zammadState === "closed") return "closed";
  return "open"; // new, open, etc.
}

/**
 * Ensure the logged-in user owns this ticket (by matching customer email).
 * Prevents replying to someone else's ticket by guessing an ID.
 */
async function assertTicketOwnedByUser(ticket: any, userEmail: string) {
  const customerId = ticket?.customer_id;
  if (!customerId) throw new Error("FORBIDDEN");

  const uRes = await fetch(`${ZAMMAD_BASE}/users/${customerId}`, {
    headers: zammadHeaders(),
  });

  if (!uRes.ok) throw new Error("FORBIDDEN");

  const customer = await uRes.json();
  const ticketEmail = (customer?.email ?? "").toLowerCase();

  if (!ticketEmail || ticketEmail !== userEmail.toLowerCase()) {
    throw new Error("FORBIDDEN");
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireUser(); // { id, email }
    const ticketId = Number(params.id);

    if (!ticketId || Number.isNaN(ticketId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TICKET_ID" },
        { status: 400 }
      );
    }

    const { message } = await req.json();

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { ok: false, error: "MESSAGE_REQUIRED" },
        { status: 400 }
      );
    }

    /**
     * 1) Load ticket
     */
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
    await assertTicketOwnedByUser(ticket, user.email);

    const ticketStateBefore = String(ticket?.state ?? "");
    const mappedStatusBefore = mapUserStatus(ticketStateBefore);

    /**
     * 2) Enforce terminal Closed state
     */
    if (mappedStatusBefore === "closed") {
      return NextResponse.json(
        {
          ok: false,
          error: "TICKET_CLOSED",
          message:
            "This ticket is closed. Please create a new ticket if you need further assistance.",
          ticketStateBefore,
          mappedStatusBefore,
        },
        { status: 409 }
      );
    }

    /**
     * 3) Create public (customer-visible) reply
     * Force sender to Customer so Zammad treats it as a customer reply.
     */
    const articleRes = await fetch(`${ZAMMAD_BASE}/ticket_articles`, {
      method: "POST",
      headers: zammadHeaders(),
      body: JSON.stringify({
        ticket_id: ticketId,
        subject: "Customer reply",
        body: message,
        type: "note",
        internal: false,
        sender: "Customer",
      }),
    });

    if (!articleRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: await articleRes.text(),
          ticketStateBefore,
          mappedStatusBefore,
        },
        { status: 502 }
      );
    }

    /**
     * 4) If ticket was Resolved (pending close), reopen it to open
     */
    if (mappedStatusBefore === "resolved") {
      const reopenRes = await fetch(`${ZAMMAD_BASE}/tickets/${ticketId}`, {
        method: "PUT",
        headers: zammadHeaders(),
        body: JSON.stringify({ state: "open" }),
      });

      if (!reopenRes.ok) {
        return NextResponse.json({
          ok: true,
          reopened: false,
          attemptedReopen: true,
          warning:
            "Reply added, but failed to reopen ticket. Agent intervention may be required.",
          ticketStateBefore,
          mappedStatusBefore,
          ticketStateAfter: ticketStateBefore,
        });
      }

      // Verify final state
      let ticketStateAfter = "open";
      const verifyRes = await fetch(`${ZAMMAD_BASE}/tickets/${ticketId}`, {
        headers: zammadHeaders(),
      });
      if (verifyRes.ok) {
        const verified = await verifyRes.json();
        ticketStateAfter = String(verified?.state ?? ticketStateAfter);
      }

      return NextResponse.json({
        ok: true,
        reopened: true,
        attemptedReopen: true,
        ticketStateBefore,
        mappedStatusBefore,
        ticketStateAfter,
        mappedStatusAfter: mapUserStatus(ticketStateAfter),
      });
    }

    /**
     * 5) Normal Open ticket reply
     */
    return NextResponse.json({
      ok: true,
      reopened: false,
      attemptedReopen: false,
      ticketStateBefore,
      mappedStatusBefore,
    });
  } catch (err: any) {
    if (err?.message === "AUTH_REQUIRED") {
      return NextResponse.json(
        { ok: false, error: "AUTH_REQUIRED" },
        { status: 401 }
      );
    }

    if (err?.message === "FORBIDDEN") {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN" },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { ok: false, error: err?.message ?? "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}
