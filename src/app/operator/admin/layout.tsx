// src/app/operator/admin/layout.tsx
"use client";

import { useEffect } from "react";
import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

/**
 * Layout for /operator/admin/* pages (Bookings, Reports).
 * - Uses the same burger header as the rest of the app
 * - Kills the legacy admin tab-bar if a page still renders it
 * - Forces a white page background for the operator-admin area
 */
export default function OperatorAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defensive removal of any legacy header that might still be rendered by older pages
  useEffect(() => {
    try {
      const suspects = new Set<Element>();
      document
        .querySelectorAll(
          [
            "header.ps-header",
            ".ps-header",
            'div[role="tablist"]',
            'header[role="tablist"]',
            'nav[data-legacy-tabs="true"]',
            'nav[aria-label="Operator sections"]',
          ].join(",")
        )
        .forEach((n) => suspects.add(n));
      [...suspects].forEach((el) => el.remove());
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Burger header (same component site-wide) */}
      <div id="ps-new-admin-topbar">
        <RoleAwareMenu />
      </div>

      {/* Spacer so the fixed header doesn’t overlap the content */}
      <div style={{ height: 64 }} aria-hidden="true" />

      {/* Page content */}
      <main className="px-4 py-6 max-w-[1200px] mx-auto">{children}</main>

      {/* Global kill-switch for any legacy operator tabs that might be injected */}
      <style jsx global>{`
        #operator-tabs,
        .operator-tabs,
        .operator-section-tabs,
        header.ps-header,
        .ps-header,
        nav[data-legacy-tabs='true'],
        nav[aria-label='Operator sections'],
        div[role='tablist'],
        header[role='tablist'] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
