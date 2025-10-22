"use client";

import * as React from "react";

/**
 * RoleAwareMenu
 * - Flat desktop bar + mobile burger.
 * - "Home" is handled by the left header label/button (links to "/"),
 *   so it is removed from the item lists.
 * - Role is resolved read-only from localStorage("ps_user") fields:
 *     site_admin (boolean), operator_admin (boolean),
 *     plus a best-effort crew/captain check.
 * - No layout/spacing changes to content: same fixed header height/padding.
 */

type RoleKey = "client" | "crew" | "operator" | "siteadmin";

type MenuItem = { label: string; href: string };
type MenuMap = Record<RoleKey, MenuItem[]>;

const MENUS: MenuMap = {
  client: [
    { label: "Login", href: "/login" },
  ],
  crew: [
    { label: "Bookings", href: "/crew/account" },
    { label: "Reports", href: "/crew/reports" }, // placeholder ok
    { label: "Login", href: "/login" },
  ],
  operator: [
    { label: "Bookings", href: "/operator/admin" },
    { label: "Routes", href: "/operator-admin/routes" },
    { label: "Vehicles", href: "/operator-admin/vehicles" },
    { label: "Staff", href: "/operator-admin/staff" },
    { label: "Reports", href: "/operator/admin/reports" },
    { label: "Login", href: "/login" },
  ],
  siteadmin: [
    { label: "Pickups", href: "/admin/pickups" },
    { label: "Destinations", href: "/admin/destinations" },
    { label: "Countries", href: "/admin/countries" },
    { label: "Routes", href: "/operator-admin/routes" }, // shared page
    { label: "Bookings", href: "/operator/admin" },      // shared page
    { label: "Vehicles", href: "/operator-admin/vehicles" }, // shared page
    { label: "Types", href: "/admin/transport-types" },
    { label: "Staff", href: "/operator-admin/staff" },   // shared page
    { label: "Operators", href: "/admin/operators" },
    { label: "Reports", href: "/admin/reports" },
    { label: "Login", href: "/login" },
  ],
};

function resolveRoleFromLocalStorage(): RoleKey {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ps_user") : null;
    if (!raw) return "client";
    const u = JSON.parse(raw) || {};
    // Highest privilege wins
    if (u.site_admin === true) return "siteadmin";
    if (u.operator_admin === true) return "operator";

    // Crew/Captain heuristic (non-breaking, read-only):
    // We accept any of these signals, if present.
    const roleText = String(
      u.jobrole || u.role || u.staff_role || ""
    ).toLowerCase();
    const isCrewish =
      roleText.includes("captain") ||
      roleText.includes("crew") ||
      u.captain === true ||
      u.crew === true;
    if (isCrewish) return "crew";

    // Fallback
    return "client";
  } catch {
    return "client";
  }
}

/** Desktop horizontal bar */
function DesktopNav({ items }: { items: MenuItem[] }) {
  return (
    <nav className="hidden md:flex items-center justify-center gap-x-6">
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className="text-sm font-semibold tracking-wide hover:opacity-90"
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** Mobile burger -> vertical list */
function MobileNav({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="md:hidden">
      <div className="flex items-center justify-between">
        {/* Left: Home (as requested) */}
        <a
          href="/"
          className="text-sm font-semibold hover:opacity-90"
          aria-label="Go to Home"
          title="Home"
        >
          Home
        </a>
        <button
          className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-neutral-600 focus:outline-none"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="space-y-1.5">
            <span className="block h-0.5 w-6 bg-white"></span>
            <span className="block h-0.5 w-6 bg-white"></span>
            <span className="block h-0.5 w-6 bg-white"></span>
          </div>
        </button>
      </div>
      {open && (
        <div className="mt-2 border-t border-neutral-600">
          <ul className="flex flex-col p-2">
            {items.map((it) => (
              <li key={it.href}>
                <a
                  className="block px-3 py-2 text-base font-medium hover:bg-neutral-600/60 rounded-lg"
                  href={it.href}
                >
                  {it.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * RoleAwareMenu
 * Fixed header with identical spacing to your current one:
 *  - fixed top-0 left-0 right-0 z-50
 *  - px-4 py-2
 *  - dark grey background (neutral-700) for clarity
 * Add backdrop-blur if you currently use it.
 */
export function RoleAwareMenu({ forceRole }: { forceRole?: RoleKey } = {}) {
  const role = forceRole ?? resolveRoleFromLocalStorage();
  const items = MENUS[role];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-4 py-2 bg-neutral-700 text-white">
      <div className="mx-auto max-w-[1120px] flex items-center justify-between">
        {/* Left: Home (desktop label) */}
        <a href="/" className="hidden md:inline text-sm font-medium hover:opacity-90">
          Home
        </a>
        {/* Desktop menu */}
        <DesktopNav items={items} />
        {/* Right spacer to balance layout on desktop */}
        <span className="hidden md:inline-block w-10" aria-hidden />
        {/* Mobile menu */}
        <MobileNav items={items} />
      </div>
    </header>
  );
}

export default RoleAwareMenu;
