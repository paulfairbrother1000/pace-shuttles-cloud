// src/components/SiteHeader.tsx
"use client";

import * as React from "react";
import Link from "next/link";
<<<<<<< HEAD
=======
import { usePathname } from "next/navigation";
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
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
<<<<<<< HEAD
  try {
    localStorage.setItem("ps_user", JSON.stringify(u || {}));
  } catch {
    /* ignore */
  }
=======
  try {
    localStorage.setItem("ps_user", JSON.stringify(u || {}));
  } catch {}
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
}

export default function SiteHeader(): JSX.Element {
<<<<<<< HEAD
=======
  const pathname = usePathname();
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
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
<<<<<<< HEAD
      if (!supabase) {
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      if (!session) {
        try {
          localStorage.removeItem("ps_user");
        } catch {
          /* ignore */
        }
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
=======
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
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9

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
<<<<<<< HEAD

        // IMPORTANT: no spaces in column list → avoids 400s in REST URL
        const byId = await supabase
          .from("users")
          .select("first_name,site_admin,operator_admin,operator_id,email")
          .eq("id", session.user.id)
          .maybeSingle();

=======
        const byId = await supabase
          .from("users")
          .select("first_name, site_admin, operator_admin, operator_id, email")
          .eq("id", session.user.id)
          .maybeSingle();
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
        if (!byId.error && byId.data) {
          row = byId.data as PsUser;
        } else if (email) {
<<<<<<< HEAD
          const byEmail = await supabase
            .from("users")
            .select("first_name,site_admin,operator_admin,operator_id,email")
            .eq("email", email)
            .maybeSingle();
=======
          const byEmail = await supabase
            .from("users")
            .select("first_name, site_admin, operator_admin, operator_id, email")
            .eq("email", email)
            .maybeSingle();
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
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
<<<<<<< HEAD
      try {
        if (!supabase) throw new Error("Supabase not configured");
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        await recomputeFromSession(data?.session ?? null);
      } catch {
        // fall back to logged-out header if anything goes wrong
        setAuthEmail(null);
        setProfile(null);
      } finally {
        if (alive) setLoading(false);
      }
=======
      if (!supabase) {
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      await recomputeFromSession(data?.session ?? null);
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9
    })();

    if (!supabase) return;

<<<<<<< HEAD
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        await recomputeFromSession(session);
      }
    );
=======
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, supabase, recomputeFromSession]);
>>>>>>> ee9b5cc6c5f59e6ed3518def3c344dfc38be94c9

    return () => {
      alive = false;
      try {
        sub?.subscription?.unsubscribe();
      } catch {
        /* ignore */
      }
    };
  }, [supabase, recomputeFromSession]);

  const firstName =
    profile?.first_name?.trim() ||
    (authEmail ? authEmail.split("@")[0] : "") ||
    "";

  return (
    <header className="ps-header">
      <style jsx global>{`
        html, body { margin: 0; padding: 0; background:#0f1a2a; }
        .ps-header {
          --bg: #0f1a2a;
          --text: #eaf2ff;
          --accent: #2a6cd6;
          --accent-contrast: #ffffff;

          width: 100%;
          background: color-mix(in oklab, var(--bg) 88%, white);
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
          color: #ffffff;
        }
        .ps-header .pill {
          border-radius: 9999px;
          padding: 0.375rem 0.75rem;
          font-size: 0.85rem;
          line-height: 1.2;
          border: 1px solid rgba(255,255,255,.18);
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
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="brand font-semibold">
            Pace Shuttles
          </Link>
        </div>

        {/* Right: Home + Login/Name */}
        <nav className="flex items-center gap-2">
          <Link href="/" className="pill text-sm">
            Home
          </Link>

          {(profile?.operator_admin || profile?.site_admin) && (
            <Link href="/operator/admin" className="pill text-sm">
              Operator Admin
            </Link>
          )}

          {profile?.site_admin && (
            <Link href="/admin" className="pill text-sm">
              Admin
            </Link>
          )}

          {authEmail ? (
            <Link href="/account" className="pill text-sm" title={authEmail}>
              {firstName || "Account"}
            </Link>
          ) : (
            <Link href="/login" className="pill text-sm">
              Login
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
