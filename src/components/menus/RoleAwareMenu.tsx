// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";

/** What we cache in localStorage("ps_user"). Only the bits we read here. */
type PsUser = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  jobrole?: string | null;
  role?: string | null;
  staff_role?: string | null;
  captain?: boolean | null;
  crew?: boolean | null;
  /** NOTE: schema calls it white_label_member in your DB. Keep both keys tolerant. */
  white_label_member?: boolean | null;
  white_label_menu?: boolean | null; // if you’ve migrated the name in your app anywhere
};

type Role = "guest" | "crew" | "operator" | "siteadmin";

function readPsUser(): PsUser | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("ps_user");
    if (!raw) return null;
    return JSON.parse(raw) as PsUser;
  } catch {
    return null;
  }
}

function isCrewFromUser(u: PsUser | null): boolean {
  if (!u) return false;
  const txt = `${u.jobrole || ""} ${u.role || ""} ${u.staff_role || ""}`.toLowerCase();
  return (
    txt.includes("captain") ||
    txt.includes("crew") ||
    u.captain === true ||
    u.crew === true
  );
}

function deriveRole(u: PsUser | null): Role {
  if (u?.site_admin) return "siteadmin";
  // Treat presence of operator_id as operator-admin (your operator pages rely on it)
  if (u?.operator_admin || u?.operator_id) return "operator";
  if (isCrewFromUser(u)) return "crew";
  return "guest";
}

function allowWhiteLabel(u: PsUser | null, role: Role): boolean {
  if (role === "siteadmin") return true; // site admin always sees it
  // You said: only operators whose operator has white_label_menu set to true.
  // Your schema column is white_label_member. Be tolerant to either flag.
  return Boolean(u?.white_label_menu ?? u?.white_label_member);
}

type MenuItem = { label: string; href: string };

/** Build menu items for a given role + user flags, then sort alphabetically (Home is injected separately) */
function buildItems(role: Role, u: PsUser | null): MenuItem[] {
  const items: MenuItem[] = [];

  if (role === "crew") {
    items.push(
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" } // placeholder page ok
    );
  }

  if (role === "operator") {
    items.push(
      { label: "Bookings", href: "/operator/admin" },                 // src/app/operator/admin/page.tsx
      { label: "Routes", href: "/operator-admin/routes" },            // shared tiles
      { label: "Vehicles", href: "/operator-admin/vehicles" },        // shared tiles
      { label: "Staff", href: "/operator-admin/staff" },              // shared tiles
      { label: "Reports", href: "/operator/admin/reports" }           // operator reports page
    );
    if (allowWhiteLabel(u, role)) {
      items.push({ label: "White Label", href: "/operator-admin/white-label" });
    }
  }

  if (role === "siteadmin") {
    items.push(
      { label: "Bookings", href: "/operator/admin" },                 // same bookings page
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Pickups", href: "/admin/pickups" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },            // shared tiles
      { label: "Staff", href: "/operator-admin/staff" },              // shared tiles
      { label: "Types", href: "/admin/transport-types" },
      { label: "Vehicles", href: "/operator-admin/vehicles" }         // shared tiles
    );
    // Admin always sees White Label
    items.push({ label: "White Label", href: "/operator-admin/white-label" });
  }

  // Alphabetical (case-insensitive)
  items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  return items;
}

/**
 * Only renders a burger + drawer for crew/operator/siteadmin.
 * Guests see nothing here. Style/markup kept exactly as your original component.
 */
export default function RoleAwareMenu() {
  const [open, setOpen] = React.useState(false);
  const [user, setUser] = React.useState<PsUser | null>(() => readPsUser());

  // Keep in sync with login/logout "ps_user" updates
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ps_user") setUser(readPsUser());
    };
    window.addEventListener("storage", onStorage);
    // Also poll once after mount in case a page wrote ps_user synchronously
    const id = setTimeout(() => setUser(readPsUser()), 0);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearTimeout(id);
    };
  }, []);

  const role = React.useMemo(() => deriveRole(user), [user]);
  if (role === "guest") return null;

  const items = React.useMemo(() => buildItems(role, user), [role, user]);

  const roleLabel =
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

  return (
    <>
      {/* Burger (forced white) – same as your original */}
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

      {/* Drawer – unchanged structure/visuals */}
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
              {/* Home first */}
              <div>
                <Link href="/" onClick={() => setOpen(false)}>Home</Link>
              </div>

              {/* Then items (alphabetical as requested) */}
              {items.map((it) => (
                <div key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)}>
                    {it.label}
                  </Link>
                </div>
              ))}

              {/* Always keep Login accessible */}
              <div>
                <Link href="/login" onClick={() => setOpen(false)}>Login</Link>
              </div>
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
