// src/app/operator-admin/layout.tsx
"use client";

// Prevent any static generation/prerender across the operator-admin subtree
export const prerender = false;
export const dynamic = "force-dynamic";
export const revalidate = 0;
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

      <RoleSwitch
        active="operator"
        show={hasBothRoles}
        operatorHref="/operator-admin"
        siteHref="/admin"
      />

      <div className="px-4 py-6">{children}</div>

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
