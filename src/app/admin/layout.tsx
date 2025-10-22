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
    } catch {/* ignore */}
  }, []);

  return (
    <div className="min-h-screen">
      {/* Fixed header stack */}
      <div className="fixed inset-x-0 top-0 z-50">
        <TopBar userName={name} homeHref="/" accountHref="/login" />
        <div className="px-4 py-3">
          <RoleSwitch
            active="site"
            show={hasBothRoles}
            operatorHref="/operator-admin"
            siteHref="/admin"
          />
        </div>
      </div>

      {/* TopBar (~56px) + RoleSwitch (~56px) => pad 7rem */}
      <main className="pt-28 px-4">{children}</main>

      {/* Kill any legacy admin menus/tabs left inside pages */}
      <style jsx global>{`
        /* Known legacy role switcher instance that some pages render */
        .mt-14.mx-4.inline-flex[role="tablist"] { display: none !important; }

        /* Generic old tab bars (links row) — hide the whole container if it contains admin links */
        :is(nav, header, div):has(> a[href^="/admin/destinations"]),
        :is(nav, header, div):has(> a[href^="/admin/pickups"]),
        :is(nav, header, div):has(> a[href^="/admin/routes"]),
        :is(nav, header, div):has(> a[href^="/admin/operators"]),
        :is(nav, header, div):has(> a[href^="/admin/vehicles"]),
        :is(nav, header, div):has(> a[href^="/admin/transport-types"]),
        :is(nav, header, div):has(> a[href^="/admin/reports"]),
        :is(nav, header, div):has(> a[href^="/admin/testing"]),
        :is(nav, header, div):has(> a[href^="/admin/countries"]) {
          display: none !important;
        }

        /* If any legacy bar was position:fixed near the top, neutralize it */
        body * {
          /* nothing */
        }
        body *[style*="position: fixed"],
        body *:where(.fixed) {
          /* Only if it’s hugging the top (<= 80px), push it back */
          top: auto !important;
        }
      `}</style>
    </div>
  );
}
