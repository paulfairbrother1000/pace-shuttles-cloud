// src/app/admin/layout.tsx
"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function SiteAdminLayout({
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
      {/* Single sticky header across all /admin pages */}
      <TopBar userName={name} homeHref="/" accountHref="/login" />

      {/* Segmented role switcher (only if user has both roles) */}
      <RoleSwitch active="site" show={hasBothRoles} operatorHref="/operator-admin" siteHref="/admin" />

      {/* Push page content below the sticky header */}
      <div className="pt-20 px-4">
        {children}
      </div>
    </div>
  );
}
