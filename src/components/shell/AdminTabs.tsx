"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/operators", label: "Operators" },
  { href: "/admin/transport-types", label: "Transport Types" },
  { href: "/admin/reports", label: "Reports" },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-1">
      {tabs.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition " +
              (active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
