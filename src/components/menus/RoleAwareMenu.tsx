"use client";

import Link from "next/link";
import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type PsUser = {
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  jobrole?: string | null;
  role?: string | null;
  staff_role?: string | null;
};

type MenuRole = "guest" | "crew" | "operator" | "siteadmin";

/* ---------- Local helpers ---------- */
function readPsUser(): PsUser | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}

function isCrewFromCache(u: PsUser | null): boolean {
  if (!u) return false;
  const txt = String(u.jobrole || u.role || u.staff_role || "").toLowerCase();
  return txt.includes("captain") || txt.includes("crew");
}

/* ---------- Build menu items (alphabetical), given role & flags ---------- */
function buildItems(role: MenuRole, opts: { whiteLabel: boolean }) {
  if (role === "siteadmin") {
    const items = [
      { label: "Bookings", href: "/operator/admin" },
      { label: "Countries", href: "/admin/countries" },
      { label: "Destinations", href: "/admin/destinations" },
      { label: "Operators", href: "/admin/operators" },
      { label: "Pickups", href: "/admin/pickups" },
      { label: "Reports", href: "/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Types", href: "/admin/transport-types" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      { label: "Login", href: "/login" },
    ];
    if (opts.whiteLabel) items.push({ label: "White Label", href: "/admin/white-label" });
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  if (role === "operator") {
    const items = [
      { label: "Bookings", href: "/operator/admin" },
      { label: "Reports", href: "/operator/admin/reports" },
      { label: "Routes", href: "/operator-admin/routes" },
      { label: "Staff", href: "/operator-admin/staff" },
      { label: "Vehicles", href: "/operator-admin/vehicles" },
      { label: "Login", href: "/login" },
    ];
    if (opts.whiteLabel) items.push({ label: "White Label", href: "/operator-admin/white-label" });
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  if (role === "crew") {
    return [
      { label: "Bookings", href: "/crew/account" },
      { label: "Reports", href: "/crew/reports" }, // placeholder/blank page is fine
      { label: "Login", href: "/login" },
    ].sort((a, b) => a.label.localeCompare(b.label));
  }

  return []; // guest
}

/* ---------- Component ---------- */
export default function RoleAwareMenu() {
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<MenuRole>("guest");
  const [items, setItems] = React.useState<{ label: string; href: string }[]>([]);

  React.useEffect(() => {
    const u = readPsUser();
    const site = !!u?.site_admin;
    const op = !!u?.operator_admin;
    const crew = isCrewFromCache(u);

    let r: MenuRole = "guest";
    if (site) r = "siteadmin";
    else if (op) r = "operator";
    else if (crew) r = "crew";
    setRole(r);

    // Site admin always gets White Label
    if (site) {
      setItems(buildItems("siteadmin", { whiteLabel: true }));
      return;
    }

    // Operator admin: check operator.white_label_member
    if (op && u?.operator_id) {
      const sb =
        typeof window !== "undefined" &&
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
          ? createBrowserClient(
              process.env.NEXT_PUBLIC_SUPABASE_URL!,
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            )
          : null;

      (async () => {
        try {
          if (!sb) {
            setItems(buildItems("operator", { whiteLabel: false }));
            return;
          }
          const { data, error } = await sb
            .from("operators")
            .select("white_label_member")
            .eq("id", u.operator_id)
            .maybeSingle();

          const wl = !!data?.white_label_member && !error;
          setItems(buildItems("operator", { whiteLabel: wl }));
        } catch {
          setItems(buildItems("operator", { whiteLabel: false }));
        }
      })();
      return;
    }

    // Crew / Guest
    setItems(buildItems(r, { whiteLabel: false }));
  }, []);

  if (role === "guest") return null; // keep header clean for guests

  const roleLabel =
    role === "siteadmin" ? "Site Admin" :
    role === "operator" ? "Operator Admin" :
    "Crew";

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

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside
            className="absolute top-0 left-0 h-full w-[80%] max-w-[380px] bg-white text-black shadow-xl"
            role="dialog"
            aria-label="Main menu"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-medium">{roleLabel}</div>
              <button aria-label="Close menu" className="w-9 h-9" onClick={() => setOpen(false)}>
                <span
                  aria-hidden
                  className="relative block w-5 h-[2px] bg-black rotate-45 before:content-[''] before:absolute before:w-5 before:h-[2px] before:bg-black before:-rotate-90"
                />
              </button>
            </div>

            <nav className="px-5 py-4 space-y-6 text-lg">
              {/* Home stays first */}
              <div>
                <Link href="/" onClick={() => setOpen(false)}>Home</Link>
              </div>

              {items.map((it) => (
                <div key={it.href}>
                  <Link href={it.href} onClick={() => setOpen(false)}>
                    {it.label}
                  </Link>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
