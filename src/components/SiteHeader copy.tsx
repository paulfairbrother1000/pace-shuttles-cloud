"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type PsUser = {
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  email?: string | null;
};

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

  // ---- NEW: central recompute helper (DB -> cache -> state)
  const recomputeFromSession = React.useCallback(
    async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"] | null) => {
      if (!session) {
        // signed out: clear everything
        localStorage.removeItem("ps_user");
        setAuthEmail(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      const email = session.user.email ?? null;
      setAuthEmail(email);

      // Use cache only if it belongs to this email AND has the role flags
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

        // Build a robust payload
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
          operator_id: row?.operator_admin ? (row?.operator_id ?? null) : null,
        };

        writeCache(payload);
        cached = payload;
      }

      setProfile(cached);
      setLoading(false);
    },
    []
  );

  React.useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data: s } = await supabase.auth.getSession();
      if (!alive) return;
      await recomputeFromSession(s?.session ?? null);
    })();

    // ---- NEW: react to auth events (sign-in/out, token refresh)
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        localStorage.removeItem("ps_user");
        setAuthEmail(null);
        setProfile(null);
      } else {
        await recomputeFromSession(session);
      }
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
    // Re-run if the route changes (in case roles were edited in /account)
  }, [pathname, recomputeFromSession]);

  const firstName =
    profile?.first_name?.trim() ||
    (authEmail ? authEmail.split("@")[0] : "") ||
    "";

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
