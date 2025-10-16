// src/app/admin/layout.tsx
"use client";

import { Suspense } from "react";
import AdminTabs from "@/components/shell/AdminTabs";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AdminTabs />
      <Suspense fallback={<div className="p-4">Loading…</div>}>
        {children}
      </Suspense>
    </>
  );
}
