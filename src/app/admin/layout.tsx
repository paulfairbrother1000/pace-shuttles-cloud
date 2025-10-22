"use client";

import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";
import { useEffect, useMemo, useState } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [hasBothRoles, setHasBothRoles] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      if (raw) {
        const u = JSON.parse(raw);
        const display =
          u?.operator_name ||
          u?.name ||
          [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
          null;
        setName(display);
        setHasBothRoles(!!(u?.site_admin && u?.operator_admin));
      }
    } catch {}
  }, []);

  // HARD KILL any legacy header/tabbars that still render on /admin/*
  useEffect(() => {
    // 1) remove any fixed headers that aren't our new one
    const our = document.getElementById("ps-new-admin-topbar");
    const isInsideOur = (n: Element) => !!our && (n === our || our.contains(n));

    document.querySelectorAll("header").forEach((h) => {
      const cs = getComputedStyle(h);
      const looksFixed = cs.position === "fixed" || h.className.includes("fixed");
      const looksLegacy =
        h.className.includes("ps-header") ||
        // old white tabbar wrapper sometimes was a header too
        h.getAttribute("role") === "tablist";
      if (!isInsideOur(h) && (looksFixed || looksLegacy)) {
        h.remove();
      }
    });

    // 2) remove the white tab row (legacy) if it exists as a DIV
    document.querySelectorAll('div[role="tablist"]').forEach((el) => {
      if (!isInsideOur(el)) el.remove();
    });

    // 3) any container that clearly holds old admin tabs (links to /admin/* sections)
    const killers = Array.from(
      document.querySelectorAll("nav,header,div")
    ).filter((el) => {
      if (isInsideOur(el)) return false;
      const anchors = Array.from(el.querySelectorAll("a"));
      const hit = anchors.some((a) =>
        /\/admin\/(destinations|pickups|routes|operators|vehicles|transport-types|reports|testing|countries)\b/i.test(
          a.getAttribute("href") || ""
        )
      );
      return hit;
    });
    killers.forEach((el) => el.remove());
  }, []);

  // extra padding only once we know if the role switch will show
  const topPad = useMemo(() => (hasBothRoles ? "pt-28" : "pt-20"), [hasBothRoles]);

  return (
    <div className="min-h-screen">
      {/* NEW sticky burger header (keep) */}
      <div id="ps-new-admin-topbar" className="fixed inset-x-0 top-0 z-50">
        <TopBar userName={name} homeHref="/" accountHref="/login" />
        <div className="px-4 py-3">
          <RoleSwitch
            active="site"
            show={hasBothRoles}
            operatorHref="/operator-admin"
            siteHref="/admin"
          />
        </div>
      </div>

      {/* push content below header (+ optional role switch) */}
      <main className={`${topPad} px-4`}>{children}</main>

      {/* CSS fallback (if the DOM removal above misses anything) */}
      <style jsx global>{`
        .ps-header,
        header.ps-header,
        div[role="tablist"] {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
