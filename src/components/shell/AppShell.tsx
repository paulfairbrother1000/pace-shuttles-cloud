"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={
        "rounded-xl px-3 py-1.5 text-sm font-medium transition " +
        (active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
      }
    >
      {children}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-3">
          <Link href="/" className="text-base font-semibold tracking-tight">Pace</Link>

          {/* Primary sections – adjust to your app */}
          <nav className="ml-4 flex items-center gap-1">
            <NavLink href="/admin">Admin</NavLink>
            <NavLink href="/operator-admin">Operator Admin</NavLink>
            <NavLink href="/pickups">Pickups</NavLink>
            <NavLink href="/reports">Reports</NavLink>
          </nav>

          {/* Right-side actions if needed */}
          <div className="ml-auto flex items-center gap-2">
            {/* e.g. account button, environment badge, etc. */}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}
