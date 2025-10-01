"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type View = {
  name: string;
  email: string;
  site_admin: boolean;
  operator_admin: boolean;
  operator_id: string | null;
};

/** 
 * v_order_history fields (option B). Some names vary across installs,
 * so we keep them optional and normalize in render.
 */
type HistoryRow = {
  user_id: string;
  order_id: string;
  order_item_id?: string | null; // not present in option B; ok if null
  booked_at: string;              // order created_at
  qty: number | null;

  // amount – view may expose either line_total_cents or total_cents
  line_total_cents?: number | null;
  total_cents?: number | null;

  route_name: string | null;
  pickup_name: string | null;
  destination_name: string | null;

  // date/time
  departure_date: string | null;  // mapped from orders.journey_date
  pickup_time?: string | null;

  // misc detail (often null in option B)
  transport_type?: string | null;
  vehicle_name?: string | null;
  operator_name?: string | null;

  // status – view may forward orders.status under various names
  item_status?: string | null;
  status?: string | null;
};

function toGBP(cents?: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    cents / 100
  );
}

export default function AccountPage() {
  /** ---------- ORIGINAL: account header state ---------- */
  const [view, setView] = useState<View>({
    name: "",
    email: "",
    site_admin: false,
    operator_admin: false,
    operator_id: null,
  });

  useEffect(() => {
    let off = false;
    (async () => {
      const { data: sRes } = await sb.auth.getSession();
      const user = sRes?.session?.user;
      if (!user) return;

      const { data: row } = await sb
        .from("users")
        .select("first_name, site_admin, operator_admin, operator_id")
        .eq("id", user.id)
        .maybeSingle();

      const firstName =
        row?.first_name ??
        (user.user_metadata?.first_name as string | undefined) ??
        (user.user_metadata?.given_name as string | undefined) ??
        (user.email ? user.email.split("@")[0] : "") ??
        "";

      const v: View = {
        name: firstName,
        email: user.email ?? "",
        site_admin: !!(row?.site_admin ?? user.user_metadata?.site_admin),
        operator_admin: !!(row?.operator_admin ?? user.user_metadata?.operator_admin),
        operator_id: row?.operator_id ?? null,
      };
      if (!off) setView(v);
    })();
    return () => { off = true; };
  }, []);

  // 👉 header cache (unchanged)
  async function refreshHeaderCache() {
    const { data: sRes } = await sb.auth.getSession();
    const user = sRes?.session?.user;

    if (!user) {
      localStorage.removeItem("ps_user");
      localStorage.setItem("ps_user_v", String(Date.now()));
      return;
    }

    const { data: row } = await sb
      .from("users")
      .select("first_name, site_admin, operator_admin, operator_id")
      .eq("id", user.id)
      .maybeSingle();

    const payload = {
      first_name:
        row?.first_name ??
        (user.user_metadata?.first_name as string | undefined) ??
        (user.user_metadata?.given_name as string | undefined) ??
        null,
      site_admin: !!(row?.site_admin ?? user.user_metadata?.site_admin),
      operator_admin: !!(row?.operator_admin ?? user.user_metadata?.operator_admin),
      operator_id: row?.operator_id ?? null,
    };

    localStorage.setItem("ps_user", JSON.stringify(payload));
    localStorage.setItem("ps_user_v", String(Date.now()));
  }

  async function signOut() {
    try {
      await sb.auth.signOut();
    } finally {
      localStorage.removeItem("ps_user");
      localStorage.setItem("ps_user_v", String(Date.now()));
      ["ps_name", "ps_header", "ps_cache"].forEach((k) => localStorage.removeItem(k));
      window.location.replace("/login");
    }
  }

  /** ---------- NEW: transaction history ---------- */
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);

  // Optional simple paging (client-side)
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return history.slice(start, start + pageSize);
  }, [page, history]);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data: sRes } = await sb.auth.getSession();
        const user = sRes?.session?.user;
        if (!user) {
          if (!off) {
            setHistory([]);
            setLoadingHistory(false);
          }
          return;
        }
        // option B exposes v_order_history; RLS is enforced by base tables
        const { data, error } = await sb
          .from("v_order_history")
          .select("*")
          .eq("user_id", user.id)
          .order("booked_at", { ascending: false });

        if (error) throw error;
        if (!off) setHistory((data as HistoryRow[]) || []);
      } catch (e: any) {
        if (!off) setHistoryMsg(e?.message || "Failed to load history.");
      } finally {
        if (!off) setLoadingHistory(false);
      }
    })();
    return () => { off = true; };
  }, []);

  function renderJourney(r: HistoryRow) {
    const legs =
      r.pickup_name && r.destination_name ? `${r.pickup_name} → ${r.destination_name}` : "";
    return (
      <>
        <div className="font-medium">{r.route_name || "Journey"}</div>
        {legs ? <div className="text-neutral-600">{legs}</div> : null}
      </>
    );
  }

  function renderAmount(r: HistoryRow) {
    const cents = r.line_total_cents ?? r.total_cents ?? null;
    return toGBP(cents);
  }

  function renderStatus(r: HistoryRow) {
    return r.item_status ?? r.status ?? "—";
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Your account</h1>

      {/* ORIGINAL account blurb */}
      <section className="rounded border p-4">
        <p><strong>Name:</strong> {view.name || "—"}</p>
        <p><strong>Email:</strong> {view.email || "—"}</p>
        <p><strong>site_admin:</strong> {String(view.site_admin)}</p>
        <p><strong>operator_admin:</strong> {String(view.operator_admin)}</p>
        <p><strong>operator_id:</strong> {view.operator_id ?? "—"}</p>
      </section>

      <div className="flex gap-3">
        <button onClick={refreshHeaderCache} className="rounded px-3 py-2 border">
          Refresh header cache
        </button>
        <button onClick={signOut} className="rounded px-3 py-2 border">
          Sign out
        </button>
      </div>

      {/* NEW: Transaction history */}
      <section className="rounded border p-4">
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>

        {historyMsg && <p className="text-sm text-red-600 mb-2">{historyMsg}</p>}
        {loadingHistory ? (
          <div className="text-sm text-neutral-600">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-neutral-600">No bookings yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="text-left p-3">Booking date</th>
                    <th className="text-left p-3">Journey</th>
                     <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Seats</th>
                    <th className="text-left p-3">Amount</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, i) => (
                    <tr key={`${r.order_id}-${i}`} className="border-t">
                      <td className="p-3">
                        {new Date(r.booked_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="p-3">{renderJourney(r)}</td>
                      <td className="p-3">
  {r.transport_type
    ? r.transport_type.replace(/_/g, " ").replace(/\b\w/g, s => s.toUpperCase())
    : "—"}
</td>
                      <td className="p-3">
                        {r.departure_date
                          ? new Date(`${r.departure_date}T12:00:00`).toLocaleDateString("en-GB")
                          : "—"}
                      </td>
                      <td className="p-3">{r.qty ?? "—"}</td>
                      <td className="p-3">{renderAmount(r)}</td>
                      <td className="p-3">{renderStatus(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* simple pager */}
            {history.length > pageSize && (
              <div className="flex items-center gap-3 mt-3">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Prev
                </button>
                <div className="text-sm">
                  Page {page} of {Math.ceil(history.length / pageSize)}
                </div>
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() =>
                    setPage((p) => Math.min(Math.ceil(history.length / pageSize), p + 1))
                  }
                  disabled={page >= Math.ceil(history.length / pageSize)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
