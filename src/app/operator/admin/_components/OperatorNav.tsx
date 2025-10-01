"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

const baseTabs = [
  { href: "/operator/admin/staff",    label: "Staff" },
  { href: "/operator/admin/vehicles", label: "Vehicles" },
  { href: "/operator/admin/routes",   label: "Routes" },
  { href: "/operator/admin/reports",  label: "Reports" },
];

type PsUser = {
  operator_admin?: boolean | null;
  operator_id?: string | null;
};

function readPsUser(): PsUser | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch { return null; }
}

export default function OperatorNav() {
  const pathname = usePathname();

  // Minimal, safe client (same pattern you use elsewhere)
  const sb: SupabaseClient | null = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createBrowserClient(url, key);
  }, []);

  const [isWlMember, setIsWlMember] = useState(false);

  useEffect(() => {
    const u = readPsUser();
    const operatorId = u?.operator_admin ? u?.operator_id ?? null : null;
    if (!sb || !operatorId) {
      setIsWlMember(false);
      return;
    }
    let off = false;
    (async () => {
      const { data, error } = await sb
        .from("operators")
        .select("white_label_member")
        .eq("id", operatorId)
        .maybeSingle();
      if (off) return;
      setIsWlMember(!!data?.white_label_member && !error);
    })();
    return () => { off = true; };
  }, [sb]);

  const tabs = isWlMember
    ? [...baseTabs, { href: "/operator/admin/white-label", label: "White Label" }]
    : baseTabs;

  return (
    <nav className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-3 flex gap-6">
        {tabs.map(t => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`text-lg rounded-full px-3 py-1.5 ${
                active ? "bg-black text-white" : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
