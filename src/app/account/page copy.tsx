"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type AuthUser = {
  id: string;
  email?: string;
};

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      const { data, error } = await supabase.auth.getUser();
      if (off) return;
      if (error) {
        setMsg(error.message);
        setUser(null);
      } else {
        setUser((data?.user as any) ?? null);
      }
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  async function signOut() {
    setMsg(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMsg(error.message);
      return;
    }
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-8">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-4">
        <p className="text-neutral-700">You’re not signed in.</p>
        <div className="flex gap-3">
          <Link href="/login" className="rounded-lg border px-4 py-2">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-lg border px-4 py-2">
            Create account
          </Link>
        </div>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Your account</h1>
      </header>

      <div className="rounded-2xl border bg-white p-5 shadow space-y-2">
        <div><span className="text-neutral-600">User ID:</span> <code>{user.id}</code></div>
        <div><span className="text-neutral-600">Email:</span> {user.email ?? "—"}</div>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div className="flex gap-3">
        <button onClick={signOut} className="rounded-lg bg-black text-white px-4 py-2">
          Sign out
        </button>
        <Link href="/" className="rounded-lg border px-4 py-2">
          Back to home
        </Link>
      </div>
    </div>
  );
}
