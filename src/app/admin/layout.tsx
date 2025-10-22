// src/app/admin/layout.tsx
"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function AdminLayout({
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
    <div className="min-h-screen">
      {/* Sticky top bar across all /admin pages */}
      <TopBar userName={name} homeHref="/" accountHref="/login" />

      {/* Segmented switch (only if user has both roles) */}
      <RoleSwitch
        active="site"
        show={hasBothRoles}
        operatorHref="/operator-admin"
        siteHref="/admin"
      />

      {/* Push content below sticky header + switch */}
      <div className="pt-24 px-4">{children}</div>

      {/* Hide any legacy site-admin tab bars (just in case some pages still render them). */}
      <style jsx global>{`
        #admin-tabs,
        .admin-tabs,
        .site-tabs,
        .site-section-tabs,
        nav[data-legacy-tabs='site'],
        nav[aria-label='Site sections'] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
