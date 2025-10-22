// src/components/SiteHeader.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";
import RoleAwareMenu from "@/components/RoleAwareMenu";

type PsUser = {
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  email?: string | null;
};

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

function readCache(): PsUser | null {
  try { const raw = localStorage.getItem("ps_user"); return raw ? (JSON.parse(raw) as PsUser) : null; }
  catch { return null; }
}
function writeCache(u: PsUser) {
  try { localStorage.setItem("ps_user", JSON.stringify(u || {})); } catch {}
}

export default function SiteHeader(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<PsUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  // drawer
  const [open, setOpen] = React.useState(false);

  const supabase = React.useMemo(() => getSupabase(), []);

  const recomputeFromSession = React.useCallback(
    async (
      session:
        | Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]
        | null
    ) => {
      if (!supabase) { setAuthEmail(null); setProfile(null); setLoading(false); return; }
      if (!session) { localStorage.removeItem("ps_user"); setAuthEmail(null); setProfile(null); setLoading(false); return; }

      const email = session.user.email ?? null;
      setAuthEmail(email);

      let cached = readCache();
      const cacheLooksWrong =
        !cached ||
        (cached.email && email && cached.email !== email) ||
        cached.site_admin == null ||
        cached.operator_admin == null;

      if (cacheLooksWrong) {
        let row: PsUser | null = null;
        const byId = await supabase
          .from("users")
          .select("first_name, site_admin, operator_admin, operator_id, email")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!byId.error && byId.data) {
          row = byId.data as PsUser;
        } else if (email) {
          const byEmail = await supabase
            .from("users")
            .select("first_name, site_admin, operator_admin, operator_id, email")
            .eq("email", email)
            .maybeSingle();
          if (!byEmail.error && byEmail.data) row = byEmail.data as PsUser;
        }

        const meta = session.user.user_metadata || {};
        const firstName =
          row?.first_name || meta.first_name || meta.given_name || (email ? email.split("@")[0] : "") || null;

        const payload: PsUser = {
          email,
          first_name: firstName,
          site_admin: !!row?.site_admin,
          operator_admin: !!row?.operator_admin,
          operator_id: row?.operator_admin ? row?.operator_id ?? null : null,
        };

        writeCache(payload);
        cached = payload;
      }

      setProfile(cached);
      setLoading(false);
    },
    [supabase]
  );

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      if (!supabase) { setAuthEmail(null); setProfile(null); setLoading(false); return; }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      await recomputeFromSession(data?.session ?? null);
    })();

    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await recomputeFromSession(session);
    });

    return () => { alive = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, supabase, recomputeFromSession]);

  const firstName =
    profile?.first_name?.trim() ||
    (authEmail ? authEmail.split("@")[0] : "") ||
    "";

  /* ======================= UI ======================= */
  return (
    <>
      {/* Top bar */}
      <header
        className="fixed top-0 left-0 right-0 z-[100] bg-neutral-700 text-white"
        role="navigation"
        aria-label="Site navigation"
      >
        <div className="mx-auto max-w-6xl px-4 py-2 flex items-center justify-between">
          {/* Left: burger (white) */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 6h18M3 12h18M3 18h18" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Right: Home + Login/Account */}
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="hover:opacity-80">Home</Link>
            {authEmail ? (
              <Link href="/account" className="hover:opacity-80" title={authEmail}>
                {firstName || "Account"}
              </Link>
            ) : (
              <button
                className="hover:opacity-80"
                onClick={() => {
                  try {
                    localStorage.setItem(
                      "next_after_login",
                      typeof window !== "undefined"
                        ? window.location.pathname + window.location.search
                        : "/"
                    );
                  } catch {}
                  router.push("/login");
                }}
              >
                Login
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Left drawer w/ RoleAwareMenu */}
      <div
        className={`fixed inset-0 z-[99] ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        {/* overlay */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
          onClick={() => setOpen(false)}
        />
        {/* panel */}
        <aside
          className={`absolute top-0 left-0 h-full w-[320px] max-w-[80%] bg-white text-black shadow-xl
                      transition-transform ${open ? "translate-x-0" : "-translate-x-full"}`}
          role="dialog"
          aria-label="Main menu"
        >
          <div className="p-3 border-b flex items-center justify-between">
            <div className="font-medium">Menu</div>
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="px-2 py-1 rounded border">
              Close
            </button>
          </div>
          {/* Your existing role-aware nav goes here */}
          <div className="p-3 overflow-auto h-[calc(100%-48px)]">
            <RoleAwareMenu />
          </div>
        </aside>
      </div>

      {/* spacer so page content doesn't hide under fixed bar */}
      <div aria-hidden className="h-[44px]" />
    </>
  );
}
