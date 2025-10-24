// src/app/admin/layout.tsx
"use client";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {children}

      {/* Kill any legacy operator sub-nav rows that some admin pages still render */}
      <style jsx global>{`
        /* These selectors match the old operator tabs/rows */
        #operator-tabs,
        .operator-tabs,
        .operator-section-tabs,
        nav[data-legacy-tabs="true"],
        nav[aria-label="Operator sections"] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
