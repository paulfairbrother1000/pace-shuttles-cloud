// /src/app/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/* ---------- Types ---------- */
type AccountUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  country_code: number | null;
  site_admin: boolean;
  operator_admin: boolean;
  operator_id: string | null;
};

/* ---------- Helpers ---------- */
function normBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (v == null) return false;
  return ["true", "t", "1", "yes", "y", "on"].includes(String(v).trim().toLowerCase());
}

function readPSUser(): AccountUser | null {
  try {
    const raw = localStorage.getItem("ps_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return {
      id: String(u?.id ?? ""),
      first_name: u?.first_name ?? null,
      last_name: u?.last_name ?? null,
      email: u?.email ?? null,
      mobile: u?.mobile ?? null,
      country_code: typeof u?.country_code === "number" ? u.country_code : null,
      site_admin: normBool(u?.site_admin),
      operator_admin: normBool(u?.operator_admin),
      operator_id: u?.operator_id ?? null,
    };
  } catch {
    return null;
  }
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchMe(id: string): Promise<AccountUser | null> {
  try {
    const res = await fetch("/api/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = await res.json();
    const u: AccountUser = {
      id: d.id,
      first_name: d.first_name ?? null,
      last_name: d.last_name ?? null,
      email: d.email ?? null,
      mobile: d.mobile ?? null,
      country_code: typeof d.country_code === "number" ? d.country_code : null,
      site_admin: !!d.site_admin,
      operator_admin: !!d.operator_admin,
      operator_id: d.operator_id ?? null,
    };
    try { localStorage.setItem("ps_user", JSON.stringify(u)); } catch {}
    return u;
  } catch {
    return null;
  }
}

function clearAllCookies() {
  document.cookie.split(";").forEach((c) => {
    const i = c.indexOf("=");
    const name = (i > -1 ? c.slice(0, i) : c).trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  });
}

/* ---------- Page ---------- */
export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDiag, setShowDiag] = useState(false);

  useEffect(() => {
    (async () => {
      // 1) Try localStorage (same source SiteHeader uses)
      const fromLS = readPSUser();
      if (fromLS) {
        setUser(fromLS);
        setLoading(false);
        // 2) Refresh from server for canonical flags
        setRefreshing(true);
        const fresh = await fetchMe(fromLS.id);
        if (fresh) setUser(fresh);
        setRefreshing(false);
        return;
      }

      // 3) Fallback: use uid cookie -> /api/me
      const uid = getCookie("uid");
      if (uid) {
        const fresh = await fetchMe(uid);
        setUser(fresh);
      }
      setLoading(false);
    })();
  }, []);

  const doSignOut = () => {
    try {
      localStorage.removeItem("ps_user");
      localStorage.removeItem("uid");
      sessionStorage.clear();
    } catch {}
    clearAllCookies();
    window.location.replace("/");
  };

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <p className="text-neutral-700">You’re not signed in.</p>
        <div className="flex gap-3">
          <Link href="/login" className="rounded-lg border px-4 py-2">Sign in</Link>
          <Link href="/signup" className="rounded-lg border px-4 py-2">Create account</Link>
        </div>
      </div>
    );
  }

  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Your account";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          <p className="text-neutral-600">{user.email}</p>
        </div>
        <button
          onClick={doSignOut}
          className="rounded-lg bg-black text-white px-4 py-2"
        >
          Sign out
        </button>
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow space-y-3">
        <h2 className="font-semibold">Access</h2>
        <div className="flex flex-wrap gap-2">
          <span className={`px-3 py-1 rounded-full text-sm ${user.site_admin ? "bg-black text-white" : "bg-neutral-100"}`}>
            Site Admin: {String(user.site_admin)}
          </span>
          <span className={`px-3 py-1 rounded-full text-sm ${user.operator_admin ? "bg-black text-white" : "bg-neutral-100"}`}>
            Operator Admin: {String(user.operator_admin)}
          </span>
          <span className="px-3 py-1 rounded-full text-sm bg-neutral-100">
            Operator ID: {user.operator_id ?? "—"}
          </span>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          {user.site_admin && (
            <Link href="/admin" className="rounded-xl border px-4 py-2 hover:bg-neutral-50">Admin dashboard</Link>
          )}
          {(user.operator_admin || user.site_admin) && (
            <Link href="/operator/admin" className="rounded-xl border px-4 py-2 hover:bg-neutral-50">Operator admin</Link>
          )}
          <button
            onClick={async () => {
              setRefreshing(true);
              const fresh = await fetchMe(user.id);
              if (fresh) setUser(fresh);
              setRefreshing(false);
            }}
            className="rounded-xl border px-4 py-2 hover:bg-neutral-50"
          >
            {refreshing ? "Refreshing…" : "Refresh from server"}
          </button>
          <button
            onClick={() => setShowDiag((v) => !v)}
            className="rounded-xl border px-4 py-2 hover:bg-neutral-50"
          >
            {showDiag ? "Hide diagnostics" : "Show diagnostics"}
          </button>
        </div>
      </section>

      {showDiag && (
        <section className="rounded-2xl border bg-white p-5 shadow">
          <h3 className="font-semibold mb-2">Diagnostics</h3>
          <pre className="text-xs overflow-auto p-3 bg-black text-green-400 rounded-lg">
{JSON.stringify({ user, cookies: document.cookie }, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
