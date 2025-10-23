"use client";

import Link from "next/link";
import * as React from "react";

/** localStorage("ps_user") shape – only the bits we use here */
type PsUser = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  jobrole?: string | null;
  role?: string | null;
  staff_role?: string | null;
  captain?: boolean | null;
  crew?: boolean | null;
  white_label_member?: boolean | null; // DB column
  white_label_menu?: boolean | null;   // tolerate alternative flag name
};

type Role = "guest" | "crew" | "operator" | "siteadmin";

declare global {
  interface Window {
    __PS_BURGER_MOUNTED__?: boolean; // singleton guard
  }
}

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
  if (u?.operator_admin || u?.operator_id) return "operator";
  if (isCrewFromUser(u)) return "crew";
  return "guest";
}

function allowWhiteLabel(u: PsUser | null, role: Role): boolean {
  if (role === "siteadmin") return true;
  return Boolean(u?.white_label_menu ?? u?.white_label_member);
}

type MenuItem = { label: string; href: string };

function buildItems(role: Role, u: PsUser | null): MenuItem[] {
  const items: MenuItem[] = [];

  if (role === "crew") {
    items.push(
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" }
    );
  }

  if (role === "operator") {
    items.push(
      { label: "Bookings", href: "/operator/admin" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      { label: "Reports", href: "/operator/admin/reports" }
    );
    if (allowWhiteLabel(u, role)) {
      items.push({ label: "White Label", href: "/operator-admin/white-label" });
    }
  }

  if (role === "siteadmin") {
    items.push(
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
      { label: "White Label", href: "/operator-admin/white-label" }
    );
  }

  // Alphabetical (Home is injected separately in the drawer)
  items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  return items;
}

/**
 * Burger + drawer for crew/operator/siteadmin.
 * - No "Login" entry (header has it permanently).
 * - Singleton guard to avoid duplicate burgers (only first mount renders).
 */
export default function RoleAwareMenu() {
  const [open, setOpen] = React.useState(false);
  const [user, setUser] = React.useState<PsUser | null>(() => readPsUser());
  const [allowedToRender, setAllowedToRender] = React.useState(false);

  // Singleton guard – only one burger at a time (e.g., the one inside TopBar)
  React.useEffect(() => {
    if (window.__PS_BURGER_MOUNTED__) {
      setAllowedToRender(false);
      return;
    }
    window.__PS_BURGER_MOUNTED__ = true;
    setAllowedToRender(true);
    return () => {
      // release guard on unmount (route change/unload)
      if (window.__PS_BURGER_MOUNTED__) {
        delete window.__PS_BURGER_MOUNTED__;
      }
    };
  }, []);

  // Keep in sync with ps_user changes
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ps_user") setUser(readPsUser());
    };
    window.addEventListener("storage", onStorage);
    const id = setTimeout(() => setUser(readPsUser()), 0);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearTimeout(id);
    };
  }, []);

  const role = React.useMemo(() => deriveRole(user), [user]);
  if (!allowedToRender || role === "guest") return null;

  const items = React.useMemo(() => buildItems(role, user), [role, user]);
  const roleLabel =
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

  return (
    <>
      {/* Burger (forced white) – same visual as before */}
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

              {/* Role-specific items (alphabetical) */}
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
