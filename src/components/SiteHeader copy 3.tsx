// src/components/SiteHeader.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<PsUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const supabase = React.useMemo(() => getSupabase(), []);

  const recomputeFromSession = React.useCallback(
    async (
      session:
        | Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]
        | null
    ) => {
      if (!supabase) {
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
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await recomputeFromSession(session);
    });

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

  return (
    <header className="ps-header">
      {/* Global fixes to kill any white gaps and ensure full-bleed header */}
      <style jsx global>{`
        html, body { margin: 0; padding: 0; background:#0f1a2a; }
        .ps-header {
          position: sticky;
          top: 0;
          z-index: 50;
          width: 100%;
          /* solid grey bar (no white bleed on scroll) */
          background: #454545;
          color: #ffffff;
          border-bottom: 0; /* kill thin white line on some mobiles */
        }
        .ps-header .bar {
          max-width: 72rem;
          margin: 0 auto;
          padding: 0.5rem 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: .75rem;
        }
        .ps-header a.brand,
        .ps-header .pill {
          color: #ffffff;
        }
        .ps-header .pill {
          border-radius: 9999px;
          padding: .375rem .75rem;
          font-size: .9rem;
          line-height: 1.2;
          border: 1px solid rgba(255,255,255,.18);
          background: transparent;
        }
        .ps-header .pill:hover {
          background: rgba(255,255,255,.08);
        }
      `}</style>

      <div className="bar">
        {/* Left: burger (role-aware) */}
        <RoleAwareMenu
          profile={profile}
          loading={loading}
        />

        {/* Right: Home + Login/Name */}
        <nav className="flex items-center gap-2">
          <Link href="/" className="pill text-sm">Home</Link>
          {authEmail ? (
            <Link href="/account" className="pill text-sm" title={authEmail}>
              {firstName || "Account"}
            </Link>
          ) : (
            <Link href="/login" className="pill text-sm">Login</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
