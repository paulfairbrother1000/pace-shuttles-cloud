// src/app/operator-admin/template.tsx
// (Server component — no "use client")

export const prerender = false;                // disable SSG for this segment
export const dynamic = "force-dynamic";        // always render on demand
export const revalidate = 0;                   // no ISR
export const fetchCache = "default-no-store";  // no fetch caching

export default function OperatorAdminTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  // Pass-through wrapper
  return children;
}
