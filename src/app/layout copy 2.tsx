// src/app/layout.tsx

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


import "./globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Pace Shuttles",
  description: "Book shuttles, boats, and transfers easily",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Header might be a Client Component; wrapping avoids any CSR-bailout warnings */}
        <Suspense fallback={null}>
          <SiteHeader />
        </Suspense>

        {/* Children can include client subtrees that read search params */}
        <main>
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
