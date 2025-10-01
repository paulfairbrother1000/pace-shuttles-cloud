// src/app/account/page.tsx
"use client";

import { useEffect, useState } from "react";
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

type HistoryRow = {
  // columns expected from v_order_history (ok if view has extra columns)
  user_id: string;
  order_id: string;
  order_item_id: string;
  booked_at: string;               // order created_at
  qty: number;
  line_total_cents: number | null;
  route_name: string | null;
  pickup_name: string | null;
  destination_name: string | null;
  departure_date: string;
  pickup_time: string | null;
  transport_type: string | null;
  vehicle_name: string | null;
  operator_name: string | null;
  item_status: string | null;
};

export default function AccountPage() {
  /** ---------- ORIGINAL: account header state ---------- */
  const [view, setView] = useState<View>({
    name: "",
    email: "",
    site_admin: false,
    operator_admin: false,
    operator_id: null,
  });

  // Load what we show on the page
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
    return () => {
      off = true;
    };
  }, []);

  // 👉 The only thing that matters for the header: write a clean ps_user
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
      // prefer DB first_name; fall back to auth metadata; never undefined
      first_name:
        row?.first_name ??
        (user.user_metadata?.first_name as string | undefined) ??
        (user.user_metadata?.given_name as string | undefined) ??
        null,
      // ensure strict booleans so the header can read reliably
      site_admin: !!(row?.site_admin ?? user.user_metadata?.site_admin),
      operator_admin: !!(row?.operator_admin ?? user.user_metadata?.operator_admin),
      operator_id: row?.operator_id ?? null,
    };

    localStorage.setItem("ps_user", JSON.stringify(payload));
    // tiny “poke” so any listeners (header) re-read immediately
    localStorage.setItem("ps_user_v", String(Date.now()));
  }

  // ORIGINAL sign-out (unchanged)
  async function signOut() {
    try {
      await sb.auth.signOut();
    } finally {
      localStorage.removeItem("ps_user");
      localStorage.setItem("ps_user_v", String(Date.now()));
      ["ps_name", "ps_header", "ps_cache"].forEach((k) => localStorage.removeItem(k));
      window.location.replace("/login"); // hard nav so nothing stale survives
    }
  }

  /** ---------- NEW: transaction history ---------- */
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);

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
    return () => {
      off = true;
    };
  }, []);

  function money(cents?: number | null) {
    if (cents == null) return "—";
    return `$${(cents / 100).toFixed(2)}`;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Your account</h1>

      {/* ORIGINAL account blurb */}
      <section className="rounded border p-4">
        <p>
          <strong>Name:</strong> {view.name || "—"}
        </p>
        <p>
          <strong>Email:</strong> {view.email || "—"}
        </p>
        <p>
          <strong>site_admin:</strong> {String(view.site_admin)}
        </p>
        <p>
          <strong>operator_admin:</strong> {String(view.operator_admin)}
        </p>
        <p>
          <strong>operator_id:</strong> {view.operator_id ?? "—"}
        </p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Booking date</th>
                  <th className="text-left p-3">Journey</th>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Seats</th>
                  <th className="text-left p-3">Amount</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.order_item_id} className="border-t">
                    <td className="p-3">
                      {new Date(r.booked_at).toLocaleDateString()}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{r.route_name || "Journey"}</div>
                      <div className="text-neutral-600">
                        {r.pickup_name && r.destination_name
                          ? `${r.pickup_name} → ${r.destination_name}`
                          : ""}
                      </div>
                    </td>
                    <td className="p-3">
                      {new Date(r.departure_date + "T12:00:00").toLocaleDateString()}
                    </td>
                    <td className="p-3">{r.qty}</td>
                    <td className="p-3">{money(r.line_total_cents)}</td>
                    <td className="p-3">{r.item_status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
