// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";

type Profile = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  white_label_member?: boolean | null; // cached in TopBar
};

type Props = {
  /** If you already pass a profile, we’ll use it; otherwise we read ps_user. */
  profile?: Profile | null;
  loading?: boolean;
};

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

function readPsUser(): Profile | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function alpha<T extends { label: string }>(arr: T[]) {
  return [...arr].sort((a, b) => a.label.localeCompare(b.label));
}

function buildMenu(p: Profile | null): {
  role: "guest" | "crew" | "operator" | "siteadmin";
  items: { label: string; href: string }[];
} {
  // SITE ADMIN
  if (p?.site_admin) {
    const items = alpha([
      { label: "Bookings", href: "/operator/admin" },
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Pickups", href: "/admin/pickups" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Types", href: "/admin/transport-types" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      { label: "White Label", href: "/operator/admin/white-label" },
    ]);
    return { role: "siteadmin", items };
  }

  // OPERATOR ADMIN
  if (p?.operator_admin) {
    const base = [
      { label: "Bookings", href: "/operator/admin" },
      { label: "Reports", href: "/operator/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
    ];
    if (p.white_label_member) {
      base.push({ label: "White Label", href: "/operator/admin/white-label" });
    }
    return { role: "operator", items: alpha(base) };
  }

  // CREW
  if (isCrewFromCache()) {
    const items = alpha([
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" }, // placeholder
    ]);
    return { role: "crew", items };
  }

  // Guest / client (no burger)
  return { role: "guest", items: [] };
}

/**
 * Renders role-aware nav:
 * - Guests: nothing (your TopBar shows Home/Login).
 * - Mobile: burger ONLY if user has roles.
 * - Desktop: inline links for users with roles (no burger).
 */
export default function RoleAwareMenu({ profile, loading }: Props) {
  const [open, setOpen] = React.useState(false);
  const [cache, setCache] = React.useState<Profile | null>(() => profile ?? readPsUser());

  React.useEffect(() => {
    if (!profile) {
      const onUpd = () => setCache(readPsUser());
      window.addEventListener("ps_user:updated", onUpd);
      return () => window.removeEventListener("ps_user:updated", onUpd);
    }
  }, [profile]);

  const effective = profile ?? cache;
  const { role, items } = React.useMemo(() => buildMenu(effective), [effective]);

  // Hide entirely for guests (client users)
  if (role === "guest") return null;

  const roleLabel =
    loading ? "Loading…" :
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

  return (
    <>
      {/* Desktop: inline links (NO burger) */}
      <nav className="hidden md:flex items-center gap-4">
        {items.map((it) => (
          <Link
            key={`${it.label}-${it.href}`}
            href={it.href}
            className="text-sm text-neutral-700 hover:text-black"
          >
            {it.label}
          </Link>
        ))}
      </nav>

      {/* Mobile: burger ONLY if user has roles */}
      <div className="md:hidden">
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center w-9 h-9"
        >
          {/* burger icon (inherit current text color; remove forced white) */}
          <span
            aria-hidden
            className="relative block w-6 h-[2px] bg-current before:content-[''] before:absolute before:w-6 before:h-[2px] before:bg-current before:-translate-y-2 after:content-[''] after:absolute after:w-6 after:h-[2px] after:bg-current after:translate-y-2"
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
                {/* NOTE: Home/Login live in the header for everyone, so not duplicated here */}
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
      </div>
    </>
  );
}
