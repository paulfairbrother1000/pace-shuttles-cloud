// src/components/SiteHeader.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";
import RoleAwareMenu from "@/components/menus/RoleAwareMenu";

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
  try {
    const raw = localStorage.getItem("ps_user");
    return raw ? (JSON.parse(raw) as PsUser) : null;
  } catch {
    return null;
  }
}
function writeCache(u: PsUser) {
  try {
    localStorage.setItem("ps_user", JSON.stringify(u || {}));
  } catch {}
}

export default function SiteHeader(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<PsUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  const supabase = React.useMemo(() => getSupabase(), []);

  const recomputeFromSession = React.useCallback(
    async (
      session:
        | Awaited<
            ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>
          >["data"]["session"]
        | null
    ) => {
      if (!supabase) {
        localStorage.removeItem("ps_user");
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      if (!session) {
        localStorage.removeItem("ps_user");
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }

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
          .select(
            "first_name, site_admin, operator_admin, operator_id, email"
          )
          .eq("id", session.user.id)
          .maybeSingle();
        if (!byId.error && byId.data) {
          row = byId.data as PsUser;
        } else if (email) {
          const byEmail = await supabase
            .from("users")
            .select(
              "first_name, site_admin, operator_admin, operator_id, email"
            )
            .eq("email", email)
            .maybeSingle();
          if (!byEmail.error && byEmail.data) row = byEmail.data as PsUser;
        }

        const meta = session.user.user_metadata || {};
        const firstName =
          row?.first_name ||
          meta.first_name ||
          meta.given_name ||
          (email ? email.split("@")[0] : "") ||
          null;

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
      if (!supabase) {
        localStorage.removeItem("ps_user");
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      await recomputeFromSession(data?.session ?? null);
    })();

    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await recomputeFromSession(session);
      }
    );

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, supabase, recomputeFromSession]);

  const firstName =
    profile?.first_name?.trim() ||
    (authEmail ? authEmail.split("@")[0] : "") ||
    "";

  // ✅ single source of truth for role presence
  const hasRole =
    !!profile?.site_admin || !!profile?.operator_admin || !!profile?.operator_id;

  return (
    <header className="ps-header">
      {/* Theme (unchanged) */}
      <style jsx global>{`
        .ps-header {
          --bg: var(--bg, #0f1a2a);
          --border: var(--border, #20334d);
          --text: var(--text, #eaf2ff);
          --muted: var(--muted, #a3b3cc);
          --accent: var(--accent, #2a6cd6);
          --accent-contrast: var(--accent-contrast, #ffffff);
          --radius: var(--radius, 14px);
          --nav-bg: color-mix(in oklab, var(--bg) 88%, white);
          width: 100%;
          background: var(--nav-bg);
          color: var(--text);
          border-bottom: 1px solid color-mix(in oklab, var(--bg) 70%, white 0%);
        }
        .ps-header .bar {
          max-width: 72rem;
          margin: 0 auto;
          padding: 0.75rem 1.5rem;
        }
        .ps-header a.brand {
          color: var(--text);
          text-decoration: none;
        }
        .ps-header .pill {
          border-radius: 9999px;
          padding: 0.375rem 0.75rem;
          font-size: 0.85rem;
          line-height: 1.2;
          border: 1px solid color-mix(in oklab, var(--bg) 60%, white 0%);
          color: var(--text);
          background: transparent;
          transition: background-color 0.15s ease, opacity 0.15s ease;
        }
        .ps-header .pill:hover {
          background: color-mix(in oklab, var(--bg) 80%, white 0%);
        }
        .ps-header .pill.active {
          background: var(--accent);
          color: var(--accent-contrast);
          border-color: transparent;
        }
      `}</style>

      <div className="bar flex items-center justify-between">
        {/* LEFT: burger (mobile) + brand; desktop shows role bar */}
        <div className="relative flex items-center gap-3 flex-1">
          {/* Mobile burger: only when roles exist, and only after loading */}
          <div className="shrink-0 md:hidden">
            {!loading && hasRole ? (
              <RoleAwareMenu profile={profile} loading={loading} />
            ) : null}
          </div>

          {/* Desktop role bar: show on md+ when roles exist */}
          <div className="hidden md:block">
            {!loading && hasRole ? (
              <RoleAwareMenu profile={profile} loading={loading} />
            ) : null}
          </div>

          {/* Brand */}
          <div className="absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0">
            <Link href="/" className="brand font-semibold">
              Pace Shuttles
            </Link>
          </div>
        </div>

        {/* RIGHT: Pills */}
        <nav className="flex items-center gap-2">
          {/* While loading, avoid flashing the client menu */}
          {loading ? null : hasRole ? (
            // When user has roles, keep the right side minimal (Support + Account)
            <>
              <Link href="/support" className="pill text-sm">
                Support
              </Link>
              <Link href="/account" className="pill active text-sm" title={authEmail ?? ""}>
                {firstName || "Account"}
              </Link>
            </>
          ) : (
            // Client-only (no roles): Home + Chat/Support + Login/Account
            <>
              <Link href="/" className="pill active text-sm">
                Home
              </Link>
              {authEmail ? (
                <Link href="/support" className="pill text-sm">
                  Support
                </Link>
              ) : (
                <Link href="/chat" className="pill text-sm">
                  Chat
                </Link>
              )}
              {authEmail ? (
                <Link href="/account" className="pill active text-sm" title={authEmail}>
                  {firstName || "Account"}
                </Link>
              ) : (
                <Link href="/login" className="pill active text-sm">
                  Login
                </Link>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
