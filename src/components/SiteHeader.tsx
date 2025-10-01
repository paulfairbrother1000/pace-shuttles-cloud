"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

type PsUser = {
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  email?: string | null;
};

/* ------------------------------------------------------------------ */
/* Safe client factory: only create a Supabase client if envs exist.   */
/* If they don't, we render a basic header without auth state.         */
/* ------------------------------------------------------------------ */
function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

/* ---------- tiny localStorage cache for profile ---------- */
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
  } catch {
    /* ignore */
  }
}

export default function SiteHeader(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  const [authEmail, setAuthEmail] = React.useState<string | null>(null);
  const [profile, setProfile] = React.useState<PsUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Keep one instance per render (don't recreate on every effect tick)
  const supabase = React.useMemo(() => getSupabase(), []);

  // --- recompute profile from a session (no-ops if sb is null)
  const recomputeFromSession = React.useCallback(
    async (
      session:
        | Awaited<ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>>["data"]["session"]
        | null
    ) => {
      if (!supabase) {
        // No env vars → render without auth state
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

      // Only trust cache if it belongs to the same user and has role flags
      let cached = readCache();
      const cacheLooksWrong =
        !cached ||
        (cached.email && email && cached.email !== email) ||
        cached.site_admin == null ||
        cached.operator_admin == null;

      if (cacheLooksWrong) {
        // fetch from DB (by id, fallback by email)
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
        // No envs: just show basic nav
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      await recomputeFromSession(data?.session ?? null);
    })();

    if (!supabase) return; // nothing else to listen to

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

  /* ======================= UI (unchanged) ======================= */
  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold">
            Pace Shuttles
          </Link>
        </div>

        {/* Right: Pills */}
        <div className="flex items-center gap-2">
          <Link href="/" className="px-3 py-1.5 rounded-full bg-black text-white text-sm">
            Home
          </Link>

          {/* Operator Admin — show for operator_admin OR site_admin */}
          {(profile?.operator_admin || profile?.site_admin) ? (
            <Link
              href="/operator/admin"
              className="px-3 py-1.5 rounded-full bg-black text-white text-sm"
            >
              Operator Admin
            </Link>
          ) : null}

          {/* Site Admin */}
          {profile?.site_admin ? (
            <Link
              href="/admin"
              className="px-3 py-1.5 rounded-full bg-black text-white text-sm"
            >
              Admin
            </Link>
          ) : null}

          {/* Account/Login */}
          {authEmail ? (
            <Link
              href="/account"
              className="px-3 py-1.5 rounded-full bg-black text-white text-sm"
              title={authEmail}
            >
              {firstName || "Account"}
            </Link>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-full bg-black text-white text-sm"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
