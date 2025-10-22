// src/app/layout.tsx  (or app/layout.tsx)
import type { ReactNode } from "react";
import SiteHeader from "@/components/SiteHeader";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
