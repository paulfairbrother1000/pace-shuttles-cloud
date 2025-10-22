// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";

type Profile = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
};

type Props = {
  profile: Profile | null;
  loading?: boolean;
};

/** Build menu items per role (flat lists). */
function getMenu(profile: Profile | null): { label: string; href: string }[] {
  if (!profile) {
    // Guests / clients
    return [
      { label: "Login", href: "/login" },
      { label: "Book a Shuttle", href: "/book/country" },
    ];
  }

  if (profile.site_admin) {
    return [
      { label: "Bookings", href: "/admin/bookings" },
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Login", href: "/login" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Pickups", href: "/admin/pickups" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Routes", href: "/admin/routes" },
      { label: "Staff", href: "/admin/staff" },
      { label: "Types", href: "/admin/types" },
      { label: "Vehicles", href: "/admin/vehicles" },
    ];
  }

  if (profile.operator_admin) {
    return [
      { label: "Bookings", href: "/operator/bookings" },
      { label: "Login", href: "/login" },
      { label: "Reports", href: "/operator/reports" },
      { label: "Routes", href: "/operator/routes" },
      { label: "Staff", href: "/operator/staff" },
      { label: "Vehicles", href: "/operator/vehicles" },
    ];
  }

  // Captain/Crew
  return [
    { label: "Bookings", href: "/crew/account" },
    { label: "Login", href: "/login" },
    { label: "Reports", href: "/crew/reports" },
  ];
}

/**
 * Burger + Drawer only. NO wrapper header here.
 * SiteHeader renders the grey bar and places this on the left.
 */
export default function RoleAwareMenu({ profile, loading }: Props) {
  const [open, setOpen] = React.useState(false);
  const items = React.useMemo(() => getMenu(profile), [profile]);

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
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* panel */}
          <aside
            className="absolute top:0 top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl"
            role="dialog"
            aria-label="Main menu"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-medium">
                {loading
                  ? "Loading…"
                  : profile?.site_admin
                  ? "Site Admin"
                  : profile?.operator_admin
                  ? "Operator Admin"
                  : profile
                  ? "Crew"
                  : "Guest"}
              </div>
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
