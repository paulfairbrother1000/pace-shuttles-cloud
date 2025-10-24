// src/app/layout.tsx (root layout)
import type { ReactNode } from "react";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Single global header for the whole site */}
        <Suspense fallback={null}>
          <SiteHeader />
        </Suspense>

        {/* All pages render under a Suspense boundary */}
        <Suspense fallback={<div className="mx-auto max-w-4xl p-6">Loading…</div>}>
          {children}
        </Suspense>
      </body>
    </html>
  );
}
