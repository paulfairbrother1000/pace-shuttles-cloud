// src/app/admin/layout.tsx
"use client";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Single global header is provided by SiteHeader; do not render another here.
  return <div className="min-h-screen bg-white">{children}</div>;
}
