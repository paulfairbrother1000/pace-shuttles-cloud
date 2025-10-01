"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import supabase from "../lib/supabaseClient"; // ← your singleton client

type AuthUser = { id: string; email?: string | null };

export default function SiteHeader() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!off) setUser((data?.session?.user as any) ?? null);
    })();

    // keep in sync if session changes
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser((session?.user as any) ?? null);
    });
    return () => {
      off = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          Pace Shuttles
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">Home</Link>

          {user ? (
            <>
              {/* Always expose Admin while you test; protect routes server-side */}
              <Link href="/admin" className="hover:underline">Admin</Link>
              <Link href="/account" className="hover:underline">Account</Link>
            </>
          ) : (
            <Link href="/login" className="hover:underline">Login</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
