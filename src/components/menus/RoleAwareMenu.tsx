// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

type Profile = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
};

type Props = { profile?: Profile | null; loading?: boolean };

// ---------- NEW: keep ps_user fresh ----------
async function syncPsUserCache() {
  try {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("ps_user");
    const cached = raw ? JSON.parse(raw) : null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !key) return;
    const sb = createBrowserClient(url, key);

    // 1) Who am I?
    const { data: auth } = await sb.auth.getUser();
    const email = auth?.user?.email;
    if (!email) return;

    // 2) Fetch latest profile and (if present) operator
    const { data: userRow } = await sb
      .from("users")
      .select("id, first_name, last_name, operator_admin, site_admin, operator_id, operator_name")
      .eq("email", email)
      .maybeSingle();

    if (!userRow) return;

    // Merge with any existing shape we store in ps_user
    const next = {
      ...(cached || {}),
      ...userRow,
      // keep a few convenience mirrors many pages rely on
      name:
        cached?.name ||
        [userRow.first_name, userRow.last_name].filter(Boolean).join(" ") ||
        auth.user?.user_metadata?.full_name ||
        "",
    };

    localStorage.setItem("ps_user", JSON.stringify(next));
  } catch {
    // ignore – never block rendering
  }
}
// --------------------------------------------

function isCrewFromCache(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem("ps_user");
    if (!raw) return false;
    const u = JSON.parse(raw) || {};
    const txt = String(u.jobrole || u.role || u.staff_role || "").toLowerCase();
    return (
      txt.includes("captain") ||
      txt.includes("crew") ||
      u.captain === true ||
      u.crew === true
    );
  } catch {
    return false;
  }
}

function getMenu(profile: Profile | null): {
  role: "guest" | "crew" | "operator" | "siteadmin";
  items: { label: string; href: string }[];
} {
  if (profile?.site_admin) {
    // Site admin: operator-admin pages + site-admin pages
    return {
      role: "siteadmin",
      items: [
        { label: "Bookings", href: "/operator/admin" },
        { label: "Countries", href: "/admin/countries" },
        { label: "Destinations", href: "/admin/destinations" },
        { label: "Operators", href: "/admin/operators" },
        { label: "Reports", href: "/admin/reports" },
        { label: "Routes", href: "/operator-admin/routes" },
        { label: "Staff", href: "/operator-admin/staff" },
        { label: "Types", href: "/admin/transport-types" },
        { label: "Vehicles", href: "/operator-admin/vehicles" },
        // (Login is permanently in the chrome; don’t duplicate it in the drawer)
      ].sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  if (profile?.operator_admin) {
    return {
      role: "operator",
      items: [
        { label: "Bookings", href: "/operator/admin" },
        { label: "Reports", href: "/operator/admin/reports" },
        { label: "Routes", href: "/operator-admin/routes" },
        { label: "Staff", href: "/operator-admin/staff" },
        { label: "Vehicles", href: "/operator-admin/vehicles" },
      ].sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  if (isCrewFromCache()) {
    return {
      role: "crew",
      items: [
        { label: "Bookings", href: "/crew/account" },
        { label: "Reports", href: "/crew/reports" },
      ].sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  return { role: "guest", items: [] };
}

export default function RoleAwareMenu({ profile, loading }: Props) {
  // Always try to refresh ps_user on first mount (fixes stale operator_admin/operator_id)
  React.useEffect(() => {
    syncPsUserCache();
  }, []);

  const { role, items } = React.useMemo(
    () => getMenu(profile ?? null),
    [profile]
  );

  // Don’t render a burger for guests
  if (role === "guest") return null;

  const [open, setOpen] = React.useState(false);
  const roleLabel =
    loading
      ? "Loading…"
      : role === "siteadmin"
      ? "Site Admin"
      : role === "operator"
      ? "Operator Admin"
      : "Crew";

  return (
    <>
      {/* Burger (white) */}
      <button
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-9 h-9"
      >
        <span
          aria-hidden
          className="relative block w-6 h-[2px] bg-white before:content-[''] before:absolute before:w-6 before:h-[2px] before:bg-white before:-translate-y-2 after:content-[''] after:absolute after:w-6 after:h-[2px] after:bg-white after:translate-y-2"
        />
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside
            className="absolute top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl"
            role="dialog"
            aria-label="Main menu"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-medium">{roleLabel}</div>
              <button aria-label="Close menu" className="w-9 h-9" onClick={() => setOpen(false)}>
                <span
                  aria-hidden
                  className="relative block w-5 h-[2px] bg-black rotate-45 before:content-[''] before:absolute before:w-5 before:h-[2px] before:bg-black before:-rotate-90"
                />
              </button>
            </div>

            <nav className="px-5 py-4 space-y-6 text-lg">
              <div>
                <Link href="/" onClick={() => setOpen(false)}>
                  Home
                </Link>
              </div>
              {items.map((it) => (
                <div key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)}>
                    {it.label}
                  </Link>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
