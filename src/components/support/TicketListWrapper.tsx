"use client";

import React, { useEffect, useMemo, useState } from "react";

type Ticket = {
  id: string | number;
  subject?: string | null;
  booking_ref?: string | null;
  status?: "open" | "pending" | "closed" | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export default function TicketListWrapper({
  title = "My tickets",
  tickets: initial = [],
  pollMs = 30000, // 30s lightweight polling to keep fresh
}: {
  title?: string;
  tickets?: Ticket[];
  pollMs?: number | null;
}) {
  const [tickets, setTickets] = useState<Ticket[]>(initial);
  const [loading, setLoading] = useState(!initial?.length);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/tickets/list", {
        method: "GET",
        credentials: "include", // include cookies/session
        cache: "no-store",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) ?? [];
      setTickets(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initial?.length) load();
    if (pollMs && pollMs > 0) {
      const t = setInterval(load, pollMs);
      return () => clearInterval(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return [...tickets].sort((a, b) => {
      const ua = Date.parse(a.updated_at || a.created_at || "1970-01-01");
      const ub = Date.parse(b.updated_at || b.created_at || "1970-01-01");
      return ub - ua;
    });
  }, [tickets]);

  return (
    <div className="rounded-2xl border border-[color-mix(in_oklab,_#0f1a2a_70%,_white_14%)] bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_6%)]">
      <div className="px-4 py-3 border-b border-[color-mix(in_oklab,_#0f1a2a_70%,_white_14%)]">
        <h3 className="font-semibold text-[#eaf2ff]">{title}</h3>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-sm text-[#a3b3cc]">Loading tickets…</div>
      ) : error ? (
        <div className="px-4 py-6 text-sm text-red-300">Error: {error}</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-[#a3b3cc]">No tickets yet.</div>
      ) : (
        <ul className="divide-y divide-[color-mix(in_oklab,_#0f1a2a_70%,_white_14%)]">
          {rows.map((t) => (
            <li key={String(t.id)} className="px-4 py-3 flex items-start gap-3">
              <StatusBadge status={t.status} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-[15px] text-[#eaf2ff] font-medium">
                    {t.subject || `Ticket #${t.id}`}
                  </span>
                  {t.booking_ref && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-[#375882] text-[#a3b3cc]">
                      Booking {t.booking_ref}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#93a6c2] mt-1">
                  Updated {fmtWhen(t.updated_at || t.created_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const s = (status || "open").toLowerCase();
  const map: Record<string, string> = {
    open: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-200 border-amber-500/30",
    closed: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  };
  const cls = map[s] || map.open;
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded border ${cls} shrink-0 mt-0.5`}>
      {s}
    </span>
  );
}

function fmtWhen(iso?: string | null) {
  if (!iso) return "just now";
  try {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return "some time ago";
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "some time ago";
  }
}
