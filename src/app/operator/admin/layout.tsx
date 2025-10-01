"use client";

import Link from "next/link";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

function Tab({ href, children }: PropsWithChildren<{ href: string }>) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      prefetch={false} // prevent background requests from other tabs
      className={[
        "px-4 py-2 rounded-full",
        active ? "bg-black text-white" : "text-black hover:bg-neutral-100",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

type PsUser = { operator_admin?: boolean | null; operator_id?: string | null };

function readPsUser(): PsUser | null {
  try { return JSON.parse(localStorage.getItem("ps_user") || "null"); } catch { return null; }
}

export default function OperatorAdminLayout({ children }: PropsWithChildren) {
  // Minimal, safe client (same pattern you already use elsewhere)
  const sb: SupabaseClient | null = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return (url && key) ? createBrowserClient(url, key) : null;
  }, []);

  const [showWL, setShowWL] = useState(false);

  useEffect(() => {
    const u = readPsUser();
    const operatorId = u?.operator_admin ? u?.operator_id ?? null : null;
    if (!sb || !operatorId) { setShowWL(false); return; }

    let off = false;
    (async () => {
      const { data, error } = await sb
        .from("operators")
        .select("white_label_member")
        .eq("id", operatorId)
        .maybeSingle();
      if (!off) setShowWL(!!data?.white_label_member && !error);
    })();

    return () => { off = true; };
  }, [sb]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <header className="flex items-center justify-between border-b pb-3">
        <div className="text-lg font-semibold">Pace Shuttles</div>
        <nav className="flex gap-3">
          <Tab href="/operator/admin/staff">Staff</Tab>
          <Tab href="/operator/admin/vehicles">Vehicles</Tab>
          <Tab href="/operator/admin/routes">Routes</Tab>
          <Tab href="/operator/admin/reports">Reports</Tab>
          {showWL && <Tab href="/operator/admin/white-label">White Label</Tab>}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
