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
  profile?: Profile | null;
  loading?: boolean;
};

/* ------------------------------ helpers ------------------------------ */

function readPsUserRaw(): any | null {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isSignedInFromCache(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const u = readPsUserRaw();
    if (!u) return false;
    return Boolean(u.id || u.user_id || u.email || u.session || u.token || u.role);
  } catch {
    return false;
  }
}

function isCrewFromCache(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const u = readPsUserRaw() || {};
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
  const u = readPsUserRaw();
  return u ? (u as Profile) : null;
}

function alpha<T extends { label: string }>(arr: T[]) {
  return [...arr].sort((a, b) => a.label.localeCompare(b.label));
}

/* ------------------------------ builder ------------------------------ */

function buildMenu(p: Profile | null): {
  role: "guest" | "client" | "crew" | "operator" | "siteadmin";
  burgerItems: { label: string; href: string }[]; // alpha-sorted, includes Chat/Support
} {
  const signedIn = isSignedInFromCache();

  // Base link: Chat (guest) or Support (signed-in)
  const base = signedIn
    ? [{ label: "Support", href: "/support" }]
    : [{ label: "Chat", href: "/chat" }];

  // SITE ADMIN
  if (p?.site_admin) {
    const roleSpecific = [
      { label: "Admin Support", href: "/admin/support" },
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
      { label: "White Label", href: "/operator-admin/white-label" },
    ];
    return { role: "siteadmin", burgerItems: alpha([...base, ...roleSpecific]) };
  }

  // OPERATOR ADMIN
  if (p?.operator_admin) {
    const roleSpecific = [
      { label: "Bookings", href: "/operator/admin" },
      { label: "Operator Support", href: "/operator/support" },
      { label: "Reports", href: "/operator/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      ...(p.white_label_member ? [{ label: "White Label", href: "/operator-admin/white-label" }] : []),
    ];
    return { role: "operator", burgerItems: alpha([...base, ...roleSpecific]) };
  }

  // CREW
  if (isCrewFromCache()) {
    const roleSpecific = [
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" }, // placeholder
    ];
    return { role: "crew", burgerItems: alpha([...base, ...roleSpecific]) };
  }

  // CLIENT (signed in, no special role) → just Support
  if (signedIn) {
    return { role: "client", burgerItems: alpha([...base]) };
  }

  // Guest → just Chat
  return { role: "guest", burgerItems: alpha([...base]) };
}

/* ------------------------------- component ------------------------------- */

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
  const { role, burgerItems } = React.useMemo(() => buildMenu(effective), [effective]);

  // ✅ IMPORTANT: no burger for anonymous users
  if (role === "guest") return null;

  // Desktop rendering of Chat/Support is handled in TopBar (between Home and Login).
  // Here we only render the mobile burger.
  return (
    <div className="md:hidden">
      {/* If there's only one item, a simple inline link is fine. */}
      {burgerItems.length <= 1 ? (
        <Link href={burgerItems[0].href} className="text-sm">
          {burgerItems[0].label}
        </Link>
      ) : (
        <>
          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="inline-flex items-center justify-center w-9 h-9"
          >
            <span
              aria-hidden
              className="relative block w-6 h-[2px] bg-current before:content-[''] before:absolute before:w-6 before:h-[2px] before:bg-current before:-translate-y-2 after:content-[''] after:absolute after:w-6 after:h-[2px] after:bg-current after:translate-y-2"
            />
          </button>

          {open && (
            <div className="fixed inset-0 z-[60]">
              <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
              <aside
                className="absolute top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl"
                role="dialog"
                aria-label="Main menu"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <div className="font-medium">
                    {loading
                      ? "Loading…"
                      : role === "siteadmin"
                      ? "Site Admin"
                      : role === "operator"
                      ? "Operator Admin"
                      : role === "crew"
                      ? "Crew"
                      : role === "client"
                      ? "Client"
                      : "Guest"}
                  </div>
                  <button aria-label="Close menu" className="w-9 h-9" onClick={() => setOpen(false)}>
                    <span
                      aria-hidden
                      className="relative block w-5 h-[2px] bg-black rotate-45 before:content-[''] before:absolute before:w-5 before:h-[2px] before:bg-black before:-rotate-90"
                    />
                  </button>
                </div>

                <nav className="px-5 py-4 space-y-6 text-lg">
                  {burgerItems.map((it) => (
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
      )}
    </div>
  );
}
