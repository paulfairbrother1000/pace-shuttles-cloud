"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

export default function DebugLogin() {
  const [email, setEmail] = useState("paul@paul.com");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setMsg(null);
    if (!supabase) {
      setMsg("Supabase client not configured");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      setMsg("Magic link sent (check inbox).");
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Debug Login</h1>
      <div className="space-y-2">
        <label className="block text-sm text-neutral-600">Email</label>
        <input
          className="border rounded px-3 py-2 w-full max-w-md"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <button
        onClick={signIn}
        disabled={loading}
        className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
      >
        {loading ? "Sending…" : "Send magic link"}
      </button>
      {msg && <div className="text-sm text-neutral-700">{msg}</div>}
    </div>
  );
}
