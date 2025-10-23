import type { ReactNode } from "react";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";
import HeaderBoundary from "@/components/HeaderBoundary";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={null}>
          <HeaderBoundary fallback={<div style={{height:48}}/>}>
            <SiteHeader />
          </HeaderBoundary>
        </Suspense>

        <Suspense fallback={<div className="mx-auto max-w-4xl p-6">Loading…</div>}>
          {children}
        </Suspense>
      </body>
    </html>
  );
}
