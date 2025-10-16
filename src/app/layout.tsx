// src/app/admin/layout.tsx
"use client";

import AdminTabs from "@/components/shell/AdminTabs";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminTabs />
      {children}
    </>
  );
}
