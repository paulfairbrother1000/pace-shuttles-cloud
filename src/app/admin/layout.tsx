// src/app/admin/layout.tsx
"use client";

import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* New burger header (same component as Home) */}
      <div id="ps-new-admin-topbar">
        <RoleAwareMenu />
      </div>

      {/* Spacer under fixed header (match your header height) */}
      <div style={{ height: 64 }} aria-hidden="true" />

      {/* Page content */}
      {children}
    </div>
  );
}
