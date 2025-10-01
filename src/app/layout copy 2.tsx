// src/app/layout.tsx
import "./globals.css";
import Link from "next/link";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* RED BAR: must appear on EVERY page if root layout is used */}
        <div style={{
          padding: "10px 14px",
          borderBottom: "3px solid red",
          display: "flex", gap: 12,
          fontFamily: "system-ui"
        }}>
          <Link href="/">Home</Link>
          <Link href="/login">Login</Link>
          <Link href="/account">Account</Link>
          <Link href="/admin">Admin</Link>
        </div>

        <main>{children}</main>
      </body>
    </html>
  );
}
