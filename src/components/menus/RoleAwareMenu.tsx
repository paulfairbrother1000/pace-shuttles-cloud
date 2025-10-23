// components/menus/RoleAwareMenu.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient, SupabaseClient } from "@supabase/ssr";

/** Minimal ps_user shape we read from localStorage */
type PsUser = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type OperatorRow = { id: string; white_label_member: boolean };

function makeSb(): SupabaseClient | null {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return null;
}

export default function RoleAwareMenu() {
  const sb = useMemo(() => makeSb(), []);
  const [user, setUser] = useState<PsUser | null>(null);
  const [whiteLabel, setWhiteLabel] = useState(false);

  const isSiteAdmin = !!user?.site_admin;
  const isOperatorAdmin = !!(user?.operator_admin && user?.operator_id);

  // Read ps_user
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setUser(null);
    }
  }, []);

  // Fetch operator.white_label_member if we have an operator_id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sb) return;
      if (!user?.operator_id) {
        setWhiteLabel(false);
        return;
      }
      const { data } = await sb
        .from("operators")
        .select("id,white_label_member")
        .eq("id", user.operator_id)
        .maybeSingle();
      if (!cancelled) {
        setWhiteLabel(Boolean((data as OperatorRow | null)?.white_label_member));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sb, user?.operator_id]);

  // Build role sections. Keep only the two required routing changes,
  // and inject "White Label" conditionally. Sort items by label.
  type Item = { label: string; href: string };

  const siteItems: Item[] = useMemo(() => {
    const base: Item[] = [
      // keep whatever else you already render here
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Routes", href: "/admin/routes" },
      // UPDATED: “Types” must point here
      { label: "Types", href: "/admin/transport-types" },
    ];

    // Site admin should ALSO see White Label menu item
    if (isSiteAdmin) {
      base.push({ label: "White Label", href: "/admin/white-label" });
    }

    return base.sort((a, b) => a.label.localeCompare(b.label));
  }, [isSiteAdmin]);

  const operatorItems: Item[] = useMemo(() => {
    const base: Item[] = [
      // UPDATED: “Bookings” must point here
      { label: "Bookings", href: "/operator/admin" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      // keep any other existing operator links…
    ];

    // Show White Label for operator admins only if operator has the flag,
    // OR if the user is also a site admin (site admin always sees it).
    if (whiteLabel || isSiteAdmin) {
      base.push({ label: "White Label", href: "/operator-admin/white-label" });
    }

    return base.sort((a, b) => a.label.localeCompare(b.label));
  }, [whiteLabel, isSiteAdmin]);

  // Simple burger UI (kept generic so it’s drop-in)
  const [open, setOpen] = useState(false);

  const displayName =
    user?.operator_name ||
    [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
    "";

  return (
    <header
      className="sticky top-0 z-50 bg-neutral-900 text-white"
      style={{ boxShadow: "0 1px 0 rgba(255,255,255,0.08)" }}
    >
      <div className="mx-auto max-w-[1200px] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setOpen((s) => !s)}
          className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-neutral-700"
          aria-label="Toggle menu"
        >
          ☰
        </button>
        <Link href="/" className="font-semibold tracking-wide">
          Pace Shuttles
        </Link>
        <span className="ml-auto text-sm text-neutral-300">
          {displayName || "Account"}
        </span>
      </div>

      {open && (
        <nav className="bg-neutral-800 border-t border-neutral-700">
          <div className="mx-auto max-w-[1200px] px-4 py-3 grid gap-6 md:grid-cols-2">
            {/* Site admin section */}
            {isSiteAdmin && (
              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
                  Site Admin
                </div>
                <ul className="space-y-1">
                  {siteItems.map((it) => (
                    <li key={`site-${it.href}`}>
                      <Link
                        href={it.href}
                        className="block px-3 py-2 rounded hover:bg-neutral-700"
                        onClick={() => setOpen(false)}
                      >
                        {it.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Operator admin section */}
            {isOperatorAdmin && (
              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-400 mb-2">
                  Operator Admin
                </div>
                <ul className="space-y-1">
                  {operatorItems.map((it) => (
                    <li key={`op-${it.href}`}>
                      <Link
                        href={it.href}
                        className="block px-3 py-2 rounded hover:bg-neutral-700"
                        onClick={() => setOpen(false)}
                      >
                        {it.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* If the user has neither role, we still render an empty menu gracefully */}
            {!isSiteAdmin && !isOperatorAdmin && (
              <div className="text-sm text-neutral-300">
                No admin role found for this account.
              </div>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
