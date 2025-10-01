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

export default function AccountPage() {
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

// inside src/app/account/page.tsx (or wherever that Sign out button lives)
async function signOut() {
  try {
    // 1) clear Supabase session + cookies
    await sb.auth.signOut(); // (supabase-js v2)

  } finally {
    // 2) clear header cache
    localStorage.removeItem("ps_user");

    // 3) nudge the header to re-read immediately (same-tab + other tabs)
    localStorage.setItem("ps_user_v", String(Date.now()));

    // (optional) clear any legacy keys if they ever existed in your app
    ["ps_name", "ps_header", "ps_cache"].forEach(k => localStorage.removeItem(k));

    // 4) hard navigation so no stale in-memory state survives
    window.location.replace("/login"); // or "/"
  }
}


  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Your account</h1>

      <section className="rounded border p-4">
        <p><strong>Name:</strong> {view.name || "—"}</p>
        <p><strong>Email:</strong> {view.email || "—"}</p>
        <p><strong>site_admin:</strong> {String(view.site_admin)}</p>
        <p><strong>operator_admin:</strong> {String(view.operator_admin)}</p>
        <p><strong>operator_id:</strong> {view.operator_id ?? "—"}</p>
      </section>

      <div className="flex gap-3">
        <button
          onClick={refreshHeaderCache}
          className="rounded px-3 py-2 border"
        >
          Refresh header cache
        </button>
        <button
          onClick={signOut}
          className="rounded px-3 py-2 border"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
