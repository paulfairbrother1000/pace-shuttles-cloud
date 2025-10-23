// src/app/operator-admin/layout.tsx
"use client";

import RoleAwareMenu from "@/components/menus/RoleAwareMenu";
import { useEffect } from "react";

export default function OperatorAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Optional: if any legacy operator tab bars were ever injected by pages,
  // hide them here so they don’t clash with the burger header.
  useEffect(() => {
    // no-op; style tag below handles this globally for /operator-admin/*
  }, []);

  return (
    <div className="min-h-screen">
      {/* NEW: same burger header used site-wide */}
      <div id="ps-new-admin-topbar">
        <RoleAwareMenu />
      </div>

      {/* Spacer so the fixed header doesn’t overlap the page content */}
      <div style={{ height: 64 }} aria-hidden="true" />

      {/* Page content */}
      <div className="px-4">{children}</div>

      {/* Kill-switch for any legacy operator tabs a page might still render */}
      <style jsx global>{`
        /* Common legacy selectors we used to render for operator admin */
        #operator-tabs,
        .operator-tabs,
        .operator-section-tabs,
        nav[data-legacy-tabs="true"],
        nav[aria-label="Operator sections"] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
