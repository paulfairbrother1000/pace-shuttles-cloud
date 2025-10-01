// src/app/layout.tsx
import "./globals.css";
import SiteHeader from "@/components/SiteHeader"; // adjust path if needed
import type { Metadata } from "next";
import AdminHeader from "@/components/AdminHeader"; // ← must match this path


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
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
