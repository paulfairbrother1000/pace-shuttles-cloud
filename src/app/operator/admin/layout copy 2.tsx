"use client";

import Link from "next/link";
import { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";

function Tab({ href, children }: PropsWithChildren<{ href: string }>) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      prefetch={false} // 👈 prevent background requests from other tabs (stops the 404 spam)
      className={[
        "px-4 py-2 rounded-full",
        active ? "bg-black text-white" : "text-black hover:bg-neutral-100",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export default function OperatorAdminLayout({ children }: PropsWithChildren) {
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <header className="flex items-center justify-between border-b pb-3">
        <div className="text-lg font-semibold">Pace Shuttles</div>
        <nav className="flex gap-3">
          <Tab href="/operator/admin/staff">Staff</Tab>
          <Tab href="/operator/admin/vehicles">Vehicles</Tab>
          <Tab href="/operator/admin/routes">Routes</Tab>
          <Tab href="/operator/admin/reports">Reports</Tab>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
