// src/components/Nav/TopBar.tsx  (inside the same file)
"use client";
import { useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

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
        white_label_member, // <- NEW: used by the menu
      };

      if (!cancelled) {
        localStorage.setItem("ps_user", JSON.stringify(payload));
        // helpful for the /account page you use for debugging
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

export default function TopBar(props: { userName?: string | null; homeHref: string; accountHref: string }) {
  useHydratePsUserCache();
  // ...rest of your existing TopBar (unchanged styles/structure)
}
