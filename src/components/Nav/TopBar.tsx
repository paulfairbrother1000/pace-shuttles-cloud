// src/components/Nav/TopBar.tsx
"use client";

import Link from "next/link";
import * as React from "react";
import { useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

/** --- your existing hook (unchanged) --- */
function useHydratePsUserCache() {
  useEffect(() => {
    const supa =
      typeof window !== "undefined" &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          )
        : null;
    if (!supa) return;

    let cancelled = false;

    async function refresh() {
      const { data: session } = await supa.auth.getUser();
      const authId = session?.user?.id;
      if (!authId) return;

      const { data: userRow } = await supa
        .from("users")
        .select(
          "id, first_name, last_name, email, site_admin, operator_admin, operator_id"
        )
        .eq("auth_user_id", authId)
        .maybeSingle();

      if (!userRow) return;

      let operator_name: string | null = null;
      let white_label_member = false;

      if (userRow.operator_id) {
        const { data: op } = await supa
          .from("operators")
          .select("name, white_label_member")
          .eq("id", userRow.operator_id)
          .maybeSingle();
        operator_name = op?.name ?? null;
        white_label_member = !!op?.white_label_member;
      }

      const payload = {
        id: userRow.id,
        first_name: userRow.first_name ?? null,
        last_name: userRow.last_name ?? null,
        email: userRow.email ?? null,
        site_admin: !!userRow.site_admin,
        operator_admin: !!userRow.operator_admin,
        operator_id: userRow.operator_id ?? null,
        operator_name,
        white_label_member, // <- used by menus
      };

      if (!cancelled) {
        localStorage.setItem("ps_user", JSON.stringify(payload));
        window.dispatchEvent(new Event("ps_user:updated"));
      }
    }

    refresh();

    const { data: sub } = supa.auth.onAuthStateChange(() => refresh());
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);
}

/** Signed-in check that matches RoleAwareMenu’s logic */
function useSignedInFromCache() {
  const [signedIn, setSignedIn] = React.useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("ps_user");
        if (!raw) return false;
        const u = JSON.parse(raw);
        return Boolean(u?.id || u?.user_id || u?.email || u?.session || u?.token || u?.role);
      } catch {
        return false;
      }
    };
    setSignedIn(read());
    const onUpd = () => setSignedIn(read());
    window.addEventListener("ps_user:updated", onUpd);
    return () => window.removeEventListener("ps_user:updated", onUpd);
  }, []);
  return signedIn;
}

/** Right-side links: Home · (Chat|Support) · (Login|Account) */
function RightLinks({
  homeHref = "/",
  accountHref = "/account",
}: {
  homeHref?: string;
  accountHref?: string;
}) {
  const signedIn = useSignedInFromCache();

  return (
    <div className="ml-auto flex items-center gap-6">
      <Link href={homeHref}>Home</Link>

      {/* Chat when anonymous; Support when signed in */}
      {signedIn ? (
        <Link href="/support">Support</Link>
      ) : (
        <Link href="/chat">Chat</Link>
      )}

      {/* Login when anonymous; Account when signed in */}
      {signedIn ? (
        <Link href={accountHref}>Account</Link>
      ) : (
        <Link href="/login">Login</Link>
      )}
    </div>
  );
}

/** Exported TopBar component */
export default function TopBar(props: { userName?: string | null; homeHref?: string; accountHref?: string }) {
  useHydratePsUserCache(); // keep your local cache in sync

  // Keep your existing structure; we only render the right-side trio.
  return (
    <header className="w-full border-b border-gray-200">
      <nav className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
        {/* Left: brand (unchanged) */}
        <Link href="/" className="font-semibold">
          Pace Shuttles
        </Link>

        {/* Right: Home · (Chat|Support) · (Login|Account) */}
        <RightLinks homeHref={props.homeHref} accountHref={props.accountHref} />
      </nav>
    </header>
  );
}
