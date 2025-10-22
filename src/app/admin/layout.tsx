"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [hasBothRoles, setHasBothRoles] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      if (raw) {
        const u = JSON.parse(raw);
        const display =
          u?.operator_name ||
          u?.name ||
          [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
          null;
        setName(display);
        setHasBothRoles(!!(u?.site_admin && u?.operator_admin));
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen">
      {/* New sticky bar (always top-most) */}
      <TopBar userName={name} homeHref="/" accountHref="/login" />

      {/* Role switch (only when both roles) */}
      <RoleSwitch active="site" show={hasBothRoles} operatorHref="/operator-admin" siteHref="/admin" />

      {/* Content pushed below sticky bars */}
      <div className="pt-20 px-4">{children}</div>

      {/* ──────────────────────────────────────────────────────────────
         TEMPORARY KILL-SWITCH for legacy site-admin menus/tabs.
         Remove this block after you delete the old component.
         ────────────────────────────────────────────────────────────── */}
      <style jsx global>{`
        /* The old admin tabs/menu sometimes render underneath our TopBar.
           We hide common variants here. Keep this local to /admin layout. */

        /* If the legacy bar is fixed, make sure it sits below and doesn’t catch clicks */
        .legacy-admin-menu,
        .admin-tabs,
        #admin-nav,
        #site-admin-nav {
          z-index: 1 !important;
          pointer-events: none;
        }

        /* If the legacy bar is not fixed (most cases), just hide it by structure:
           Any nav/header/div that directly contains known admin links. Uses :has(),
           which is supported in modern browsers and our admin UI. */
        :is(nav, header, div):has(> a[href="/admin/destinations"]),
        :is(nav, header, div):has(> a[href="/admin/pickups"]),
        :is(nav, header, div):has(> a[href="/admin/routes"]),
        :is(nav, header, div):has(> a[href="/admin/operators"]),
        :is(nav, header, div):has(> a[href="/admin/vehicles"]),
        :is(nav, header, div):has(> a[href="/admin/transport-types"]),
        :is(nav, header, div):has(> a[href="/admin/reports"]),
        :is(nav, header, div):has(> a[href="/admin/testing"]),
        :is(nav, header, div):has(> a[href="/admin/countries"]) {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
