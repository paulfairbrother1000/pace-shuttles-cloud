// src/app/api/support/tickets/route.ts

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import {
  ZAMMAD_BASE,
  zammadHeaders,
  mapUserStatusByStateId,
  getTicketCustomerEmail,
} from "@/lib/zammad";

type UserTicketStatus = "open" | "resolved" | "closed";

function parseStatusFilter(url: URL): UserTicketStatus | "all" {
  const s = (url.searchParams.get("status") ?? "all").toLowerCase();
  if (s === "open" || s === "resolved" || s === "closed") return s;
  return "all";
}

function toISO(dt: any): string | null {
  if (!dt) return null;
  try {
    return new Date(dt).toISOString();
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const statusFilter = parseStatusFilter(url);

    // Optional paging
    const perPage = Math.min(
      Math.max(Number(url.searchParams.get("per_page") ?? 25), 1),
      50
    );
    const page = Math.max(Number(url.searchParams.get("page") ?? 1), 1);

    /**
     * Zammad search is the best way to list tickets.
     * We filter server-side to ensure ownership.
     */
    const searchQuery = `customer.email:"${user.email}"`;
    const searchUrl =
      `${ZAMMAD_BASE}/tickets/search?query=${encodeURIComponent(searchQuery)}` +
      `&page=${page}&per_page=${perPage}&sort_by=updated_at&order_by=desc`;

    const res = await fetch(searchUrl, { headers: zammadHeaders() });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: await res.text() },
        { status: 502 }
      );
    }

    const rawTickets = await res.json();
    const ticketsArr: any[] = Array.isArray(rawTickets)
      ? rawTickets
      : rawTickets?.tickets ?? [];

    // Ownership hard-check (belt & braces)
    const owned: any[] = [];
    for (const t of ticketsArr) {
      const email = await getTicketCustomerEmail(t);
      if (email && email === user.email.toLowerCase()) owned.push(t);
    }

    const shaped = owned
      .map((t) => {
        const stateId = Number(t?.state_id);
        const userStatus = mapUserStatusByStateId(stateId);

        return {
          id: Number(t?.id),
          number: String(t?.number ?? ""),
          title: String(t?.title ?? ""),
          status: userStatus,
          // Use created_at/updated_at for UI
          createdAt: toISO(t?.created_at),
          updatedAt: toISO(t?.updated_at),
          // Optional: show a short preview
          // Zammad includes "note" sometimes; if not, leave null
          description: t?.note ? String(t.note) : null,
        };
      })
      .filter((t) => {
        if (statusFilter === "all") return true;
        return t.status === statusFilter;
      });

    return NextResponse.json({
      ok: true,
      statusFilter,
      page,
      perPage,
      tickets: shaped,
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
