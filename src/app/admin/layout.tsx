// src/app/admin/layout.tsx
"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";

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
      {/* NEW sticky header (with burger) */}
      <TopBar userName={name} homeHref="/" accountHref="/login" />

      {/* Segmented role switch (only if user has both roles) */}
      <RoleSwitch
        active="site"
        show={hasBothRoles}
        operatorHref="/operator-admin"
        siteHref="/admin"
      />

      {/* Push page content below sticky bar */}
      <div className="pt-20 px-4">{children}</div>

      {/* Hard kill any legacy admin menus that might still render inside pages/layouts */}
      <style jsx global>{`
        /* Old tabbed admin menu (if any) */
        [role="tablist"][aria-label="Admin role"],
        .admin-menu,
        .site-admin-menu,
        header.site-admin-legacy,
        nav.site-admin-legacy {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
