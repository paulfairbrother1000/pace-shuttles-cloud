// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

type Profile = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
};

type Props = {
  profile: Profile | null;
  loading?: boolean;
};

/* ---------- Local helpers ---------- */

// Read crew-ish hint from the same localStorage ("ps_user") cache
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

function readOperatorIdFromCache(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("ps_user");
    if (!raw) return null;
    const u = JSON.parse(raw) || {};
    return u?.operator_id || null;
  } catch {
    return null;
  }
}

/* Build the role + items list.
   whiteLabel indicates whether to show the White Label entry. */
function getMenu(
  profile: Profile | null,
  whiteLabel: boolean
): { role: "guest" | "crew" | "operator" | "siteadmin"; items: { label: string; href: string }[] } {
  // SITE ADMIN
  if (profile?.site_admin) {
    const items = [
      { label: "Bookings", href: "/operator/admin" },           // ← updated path
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Routes", href: "/admin/routes" },
      { label: "Staff", href: "/admin/staff" },
      { label: "Types", href: "/admin/transport-types" },       // ← updated path
      { label: "Vehicles", href: "/admin/vehicles" },
      ...(whiteLabel ? [{ label: "White Label", href: "/admin/white-label" }] : []),
      { label: "Login", href: "/login" },
    ];
    // alphabetical by label (Home is handled separately in the drawer)
    items.sort((a, b) => a.label.localeCompare(b.label));
    return { role: "siteadmin", items };
  }

  // OPERATOR ADMIN
  if (profile?.operator_admin) {
    const items = [
      { label: "Bookings", href: "/operator/admin" },           // ← updated path
      { label: "Reports", href: "/operator/reports" },
      { label: "Routes", href: "/operator/routes" },
      { label: "Staff", href: "/operator/staff" },
      { label: "Vehicles", href: "/operator/vehicles" },
      ...(whiteLabel ? [{ label: "White Label", href: "/admin/white-label" }] : []),
      { label: "Login", href: "/login" },
    ];
    items.sort((a, b) => a.label.localeCompare(b.label));
    return { role: "operator", items };
  }

  // CREW
  if (isCrewFromCache()) {
    const items = [
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" },
      { label: "Login", href: "/login" },
    ];
    items.sort((a, b) => a.label.localeCompare(b.label));
    return { role: "crew", items };
  }

  // GUEST / client (no burger)
  return { role: "guest", items: [] };
}

/**
 * Only renders a burger + drawer for crew/operator/siteadmin.
 * Guests see nothing here (header still shows "Home" and "Login/Name" on the right).
 *
 * Styling and structure are preserved exactly as your original.
 */
export default function RoleAwareMenu({ profile, loading }: Props) {
  const [open, setOpen] = React.useState(false);
  const [whiteLabel, setWhiteLabel] = React.useState(false);

  // Determine if White Label should be visible.
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // Site admin always sees White Label.
        if (profile?.site_admin) {
          if (!cancelled) setWhiteLabel(true);
          return;
        }

        // Operator admin: check operator.white_label_member
        if (profile?.operator_admin) {
          const operatorId = readOperatorIdFromCache();
          if (!operatorId) {
            if (!cancelled) setWhiteLabel(false);
            return;
          }

          // Create a browser client only when needed
          const sb =
            typeof window !== "undefined" &&
            process.env.NEXT_PUBLIC_SUPABASE_URL &&
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
              ? createBrowserClient(
                  process.env.NEXT_PUBLIC_SUPABASE_URL!,
                  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
                )
              : null;

          if (!sb) {
            if (!cancelled) setWhiteLabel(false);
            return;
          }

          const { data, error } = await sb
            .from("operators")
            .select("white_label_member")
            .eq("id", operatorId)
            .maybeSingle();

          if (error) {
            if (!cancelled) setWhiteLabel(false);
            return;
          }

          if (!cancelled) setWhiteLabel(Boolean(data?.white_label_member));
          return;
        }

        // Crew/Guest
        if (!cancelled) setWhiteLabel(false);
      } catch {
        if (!cancelled) setWhiteLabel(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [profile?.site_admin, profile?.operator_admin]);

  const { role, items } = React.useMemo(() => getMenu(profile, whiteLabel), [profile, whiteLabel]);

  // Hide entirely for guests
  if (role === "guest") return null;

  const roleLabel =
    loading ? "Loading…" :
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

  return (
    <>
      {/* Burger (forced white) */}
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
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Panel */}
          <aside
            className="absolute top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl"
            role="dialog"
            aria-label="Main menu"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-medium">{roleLabel}</div>
              <button
                aria-label="Close menu"
                className="w-9 h-9"
                onClick={() => setOpen(false)}
              >
                <span
                  aria-hidden
                  className="relative block w-5 h-[2px] bg-black rotate-45 before:content-[''] before:absolute before:w-5 before:h-[2px] before:bg-black before:-rotate-90"
                />
              </button>
            </div>

            <nav className="px-5 py-4 space-y-6 text-lg">
              {/* Always include Home at the top of the drawer */}
              <div>
                <Link href="/" onClick={() => setOpen(false)}>Home</Link>
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
