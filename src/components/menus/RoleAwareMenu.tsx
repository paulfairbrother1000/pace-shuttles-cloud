// src/components/menus/RoleAwareMenu.tsx
"use client";

import Link from "next/link";
import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

type Profile = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  white_label?: boolean | null; // computed
};

function readCache(): Partial<Profile> {
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as any) : {};
  } catch {
    return {};
  }
}
function writeCache(p: Partial<Profile>) {
  try {
    const prev = readCache();
    localStorage.setItem("ps_user", JSON.stringify({ ...prev, ...p }));
  } catch {}
}

export default function RoleAwareMenu() {
  const [open, setOpen] = React.useState(false);
  const [profile, setProfile] = React.useState<Profile | null>(null);

  // 1) show immediately from cache (so the burger never flickers)
  React.useEffect(() => {
    const cached = readCache();
    if (Object.keys(cached).length) {
      setProfile({
        site_admin: !!cached.site_admin,
        operator_admin: !!cached.operator_admin,
        operator_id: cached.operator_id ?? null,
        operator_name: cached.operator_name ?? null,
        white_label: !!cached.white_label,
      });
    }
  }, []);

  // 2) refresh from DB using supabase-js (adds Accept header → no 406)
  React.useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    const sb = createBrowserClient(url, key);

    (async () => {
      // who am I?
      const { data: auth } = await sb.auth.getUser();
      if (!auth?.user) {
        setProfile(null);
        writeCache({ site_admin: false, operator_admin: false, operator_id: null, operator_name: null, white_label: false });
        return;
      }

      // load users row + linked operator (for white_label_member + name)
      const { data, error } = await sb
        .from("users")
        .select(`
          site_admin,
          operator_admin,
          operator_id,
          operators:operator_id ( name, white_label_member )
        `)
        .eq("auth_user_id", auth.user.id)
        .maybeSingle();

      if (error) {
        // fall back to cache on any transient failure
        return;
      }

      const site_admin = !!data?.site_admin;
      const operator_admin = !!data?.operator_admin;
      const operator_id = (data?.operator_id as string | null) ?? null;
      const operator_name = (data?.operators?.name as string | null) ?? null;
      const wl = site_admin || (operator_admin && !!data?.operators?.white_label_member);

      const p: Profile = { site_admin, operator_admin, operator_id, operator_name, white_label: wl };
      setProfile(p);
      writeCache(p); // keep the single source of truth in sync
    })();
  }, []);

  // Decide role
  let role: "guest" | "crew" | "operator" | "siteadmin" = "guest";
  if (profile?.site_admin) role = "siteadmin";
  else if (profile?.operator_admin) role = "operator";
  else {
    // legacy crew hint from cache
    const txt = String((readCache() as any)?.jobrole || "").toLowerCase();
    if (txt.includes("captain") || txt.includes("crew")) role = "crew";
  }

  // Hide entirely for guests
  if (role === "guest") return null;

  const roleLabel =
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

  // Build items per your mapping (alphabetical), no "Login" anywhere
  const items: { label: string; href: string }[] = [];
  if (role === "crew") {
    items.push(
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports",  href: "/crew/reports" },
    );
  } else if (role === "operator") {
    items.push(
      { label: "Bookings", href: "/operator/admin" },                 // operator/admin
      { label: "Reports",  href: "/operator/admin/reports" },
      { label: "Routes",   href: "/operator-admin/routes" },
      { label: "Staff",    href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
    );
    // White Label only when allowed
    if (profile?.white_label) {
      items.push({ label: "White Label", href: "/operator-admin/white-label" });
    }
    // sort alpha by label
    items.sort((a, b) => a.label.localeCompare(b.label));
  } else if (role === "siteadmin") {
    items.push(
      { label: "Bookings",   href: "/operator/admin" },                 // shared
      { label: "Countries",  href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators",  href: "/admin/operators" },
      { label: "Reports",    href: "/admin/reports" },
      { label: "Routes",     href: "/operator-admin/routes" },          // shared page
      { label: "Staff",      href: "/operator-admin/staff" },           // shared page
      { label: "Types",      href: "/admin/transport-types" },
      { label: "Vehicles",   href: "/operator-admin/vehicles" },        // shared page
    );
    // Site admin always sees white label item
    items.push({ label: "White Label", href: "/operator-admin/white-label" });
    items.sort((a, b) => a.label.localeCompare(b.label));
  }

  return (
    <>
      {/* Burger (forced white) */}
      <button
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-9 h-9"
      >
        <span
          aria-hidden
          className="relative block w-6 h-[2px] bg-white before:content-[''] before:absolute before:w-6 before:h-[2px] before:bg-white before:-translate-y-2 after:content-[''] after:absolute after:w-6 after:h-[2px] after:bg-white after:translate-y-2"
        />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl" role="dialog" aria-label="Main menu">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-medium">{roleLabel}</div>
              <button aria-label="Close menu" className="w-9 h-9" onClick={() => setOpen(false)}>
                <span aria-hidden className="relative block w-5 h-[2px] bg-black rotate-45 before:content-[''] before:absolute before:w-5 before:h-[2px] before:bg-black before:-rotate-90" />
              </button>
            </div>

            <nav className="px-5 py-4 space-y-6 text-lg">
              <div><Link href="/" onClick={() => setOpen(false)}>Home</Link></div>
              {items.map(it => (
                <div key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)}>{it.label}</Link>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
