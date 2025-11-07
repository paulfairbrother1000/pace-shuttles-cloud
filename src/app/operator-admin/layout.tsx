// src/app/operator-admin/layout.tsx
"use client";

// 🚫 Tell Next.js not to prerender anything in this subtree.
// This prevents build-time SSG from touching /operator-admin/staff (or routes).
export const prerender = false;
export const dynamic = "force-dynamic";
export const revalidate = 0; // (explicit; prevents any accidental ISR)
export const fetchCache = "default-no-store";

import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function OperatorAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [hasBothRoles, setHasBothRoles] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      if (raw) {
        const u = JSON.parse(raw);
        setHasBothRoles(!!(u?.site_admin && u?.operator_admin));
      }
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* Global SiteHeader is rendered by RootLayout; do NOT render another header here. */}

      {/* Segmented switch (only if user has both roles) */}
      <RoleSwitch
        active="operator"
        show={hasBothRoles}
        operatorHref="/operator-admin"
        siteHref="/admin"
      />

      {/* Page content */}
      <div className="px-4 py-6">{children}</div>

      {/* Hide any legacy operator tabs older pages/components might inject */}
      <style jsx global>{`
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
