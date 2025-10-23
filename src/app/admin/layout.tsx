// src/app/admin/layout.tsx
"use client";

// Minimal admin layout: rely on the global TopBar from the root layout.
// Do NOT render any legacy admin tabs or headers here.

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Root layout already applies the sticky TopBar (burger) and spacing.
  // Keep this wrapper lean to avoid a second/legacy header.
  return <div className="px-4 pt-0">{children}</div>;
}
