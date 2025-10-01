"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/operator/admin/staff",    label: "Staff" },
  { href: "/operator/admin/vehicles", label: "Vehicles" },
  { href: "/operator/admin/routes",   label: "Routes" },
  { href: "/operator/admin/reports",  label: "Reports" },
];

export default function OperatorNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-3 flex gap-6">
        {tabs.map(t => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`text-lg rounded-full px-3 py-1.5 ${
                active ? "bg-black text-white" : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
