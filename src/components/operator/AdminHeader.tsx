"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/destinations", label: "Destinations" },
  { href: "/admin/pickups",      label: "Pick Ups" },
  { href: "/admin/routes",       label: "Routes" },
  { href: "/admin/countries",    label: "Countries" },
  { href: "/admin/operators",    label: "Operators" },
  { href: "/admin/vehicles",     label: "Vehicles" },
];

export default function AdminHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-4 text-lg font-semibold">
        Pace Shuttles — Admin
      </div>
      <nav className="mx-auto max-w-6xl px-6 pb-3 flex gap-6">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                "text-sm rounded-full px-3 py-1.5 " +
                (active ? "bg-black text-white" : "text-neutral-700 hover:bg-neutral-100")
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
