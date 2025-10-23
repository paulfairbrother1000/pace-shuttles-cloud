"use client";

import { useEffect, useState } from "react";
import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

/**
 * Site Admin layout
 * - Renders the new burger/role-aware top menu once.
 * - Hides the legacy white tab bar on admin pages via scoped CSS.
 * - Adds top padding so page content clears the fixed header.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Optional: wait for client to avoid any hydration flicker for the fixed bar
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-screen">
      {/* NEW burger header (the same one the home page uses) */}
      {mounted && <RoleAwareMenu />}

      {/* Hide the legacy header/tabs ONLY on /admin routes */}
      <style jsx global>{`
        /* Old white tab bar & legacy header variants */
        header.ps-header,
        .ps-header,
        [role="tablist"] {
          display: none !important;
        }
      `}</style>

      {/* Push content below fixed header (RoleAwareMenu is fixed top) */}
      <div className="pt-20 px-4">{children}</div>
    </div>
  );
}
