// src/app/operator-admin/layout.tsx
"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function OperatorAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
    <div className="min-h-screen bg-white">
      {/* Sticky top bar used site-wide (contains the single burger menu) */}
      <TopBar userName={name} homeHref="/" accountHref="/account" />

      {/* Segmented switch (only if user has both roles) */}
      <RoleSwitch
        active="operator"
        show={hasBothRoles}
        operatorHref="/operator-admin"
        siteHref="/admin"
      />

      {/* Push content below sticky header + switch */}
      <div className="pt-24 px-4">{children}</div>

      {/* Kill any legacy operator tabs that older pages/components might inject */}
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
