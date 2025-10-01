// src/app/layout.tsx
import "./globals.css";
import SiteHeader from "../components/SiteHeader";

export const metadata = {
  title: "Pace Shuttles",
  description: "Operator admin and user portal",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white antialiased">
        <SiteHeader />            {/* ← this brings back Home / Operator Admin / Admin / Account */}
        <main className="mx-auto max-w-[1120px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
