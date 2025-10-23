"use client";

import { useEffect } from "react";
import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

/**
 * Admin layout: render the same burger header used on Home
 * and (optionally) remove only the legacy tab header if it appears.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // VERY narrow legacy cleanup so we never touch the new menu
  useEffect(() => {
    try {
      const legacy = [
        ...document.querySelectorAll("header.ps-header, .ps-header"),
        ...document.querySelectorAll('[role="tablist"]'),
      ];
      legacy.forEach((el) => {
        if (!document.getElementById("ps-new-admin-topbar")?.contains(el)) {
          el.remove();
        }
      });
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen">
      {/* New shared burger header (same as Home) */}
      <div id="ps-new-admin-topbar" className="relative z-[60]">
        <RoleAwareMenu />
      </div>

      {/* Spacer so fixed header doesn’t overlap content */}
      <div className="h-16" aria-hidden="true" />

      <main>{children}</main>
    </div>
  );
}
