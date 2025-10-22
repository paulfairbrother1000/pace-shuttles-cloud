"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

/**
 * Site Admin layout:
 * - TopBar is fixed at z-50
 * - RoleSwitch is placed directly under it inside the same header stack
 * - Content is padded to sit below both, so nothing overlaps
 * - Legacy admin tab bars are hidden here (temporary kill-switch)
 */
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
      {/* Fixed header stack */}
      <div className="fixed inset-x-0 top-0 z-50">
        <TopBar userName={name} homeHref="/" accountHref="/login" />
        {/* Keep RoleSwitch right under the TopBar; remove its external margins */}
        <div className="px-4 py-3 bg-transparent">
          <RoleSwitch
            active="site"
            show={hasBothRoles}
            operatorHref="/operator-admin"
            siteHref="/admin"
            /* if your RoleSwitch adds margin by default, it will be visually fine here */
          />
        </div>
      </div>

      {/* Push content below BOTH bars:
         ~56–60px TopBar + ~56px RoleSwitch area ≈ 7rem (28) */}
      <main className="pt-28 px-4">{children}</main>

      {/* ──────────────────────────────────────────────────────────────
         TEMP: hide any legacy tabbars/menus still rendered by pages.
         Remove once you delete those old components.
         ────────────────────────────────────────────────────────────── */}
      <style jsx global>{`
        /* Don’t let any old fixed bars sit above our TopBar */
        .legacy-admin-menu,
        .admin-tabs,
        #admin-nav,
        #site-admin-nav {
          z-index: 1 !important;
          pointer-events: none;
        }

        /* Hide containers that directly include the legacy admin links */
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
