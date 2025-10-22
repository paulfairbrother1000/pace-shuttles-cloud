"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useState } from "react";

export default function OperatorAdminLayout({ children }: { children: React.ReactNode }) {
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
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="min-h-screen">
      <div className="fixed inset-x-0 top-0 z-50">
        <TopBar userName={name} homeHref="/" accountHref="/login" />
        <div className="px-4 py-3">
          <RoleSwitch
            active="operator"
            show={hasBothRoles}
            operatorHref="/operator-admin"
            siteHref="/admin"
          />
        </div>
      </div>

      <main className="pt-28 px-4">{children}</main>

      {/* Hide legacy headers/old tabbars if a page still renders them */}
      <style jsx global>{`
        .ps-header,
        header.ps-header,
        header[aria-label="Top navigation"] {
          display: none !important;
        }
        .mt-14.mx-4.inline-flex[role="tablist"] { display: none !important; }
      `}</style>
    </div>
  );
}
