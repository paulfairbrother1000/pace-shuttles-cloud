"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = React.useMemo(() => {
    const p = sp.get("next");
    if (p) return p;
    try {
      const saved = localStorage.getItem("next_after_login");
      if (saved) return saved;
    } catch {}
    return "/account";
  }, [sp]);

  const [mode, setMode] = React.useState<"login" | "signup">("login");

  // Shared
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Signup-only
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [mobile, setMobile] = React.useState("");
  const [countryCode, setCountryCode] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);

  const cachePsUser = React.useCallback(async () => {
    try {
      const { data: ures } = await sb.auth.getUser();
      const u = ures?.user;
      if (!u) return;

      const me = await sb
        .from("users")
        .select("first_name, site_admin, operator_admin, operator_id")
        .eq("id", u.id)
        .single();

      if (!me.error && me.data) {
        localStorage.setItem("ps_user", JSON.stringify(me.data));
      } else {
        localStorage.removeItem("ps_user");
      }
    } catch {}
  }, []);

  const goNext = React.useCallback((url: string) => {
    try {
      router.replace(url);
      setTimeout(() => {
        if (window.location.pathname.startsWith("/login")) {
          window.location.assign(url);
        }
      }, 50);
    } catch {
      window.location.assign(url);
    }
  }, [router]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await sb.auth.getSession();
      if (!alive) return;
      if (data?.session?.user) {
        void cachePsUser();
        goNext(nextUrl);
      } else {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [goNext, nextUrl, cachePsUser]);

  async function postAuthHousekeeping() {
    // Link crew user ↔ operator_staff by email (idempotent)
    try { await fetch("/api/crew/auto-link", { method: "POST" }); } catch {}
    // Refresh cached header/menu user badge
    void cachePsUser();
    try { localStorage.removeItem("next_after_login"); } catch {}
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWorking(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await postAuthHousekeeping();
      goNext(nextUrl);
    } catch (err: any) {
      setMsg(err?.message || "Invalid login credentials");
    } finally {
      setWorking(false);
    }
  }

 async function onSignup(e: React.FormEvent) {
  e.preventDefault();
  setMsg(null);

  // basic client validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return setMsg("Please enter a valid email address.");
  if (!firstName.trim() || !lastName.trim()) return setMsg("Please provide first and last name.");
  if (password.length < 6) return setMsg("Password must be at least 6 characters.");
  if (password !== confirmPassword) return setMsg("Passwords do not match.");

  setWorking(true);
  try {
    // Create account (no email confirmation if it's disabled in Supabase)
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName.trim(), last_name: lastName.trim() },
      },
    });

    if (error) {
      // Surface the real provider message (e.g., "Email signups are disabled")
      throw new Error(error.message || "Sign up failed");
    }

    const user = data.user;
    if (!user) {
      // Shouldn’t happen when “Confirm email” is OFF, but handle gracefully
      throw new Error("Account created, but no session returned. Check Supabase email confirmation settings.");
    }

    // Make sure we have a row in public.users (UPDATE fails if it doesn’t exist)
    const mobileNum = mobile.trim() ? Number(mobile.trim()) : null;
    const ccNum = countryCode.trim() ? Number(countryCode.trim()) : null;

    const upsertRow: Record<string, any> = {
      id: user.id, // <- crucial
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email, // helpful for your header/menu fetches
    };
    if (Number.isFinite(mobileNum)) upsertRow.mobile = mobileNum;
    if (Number.isFinite(ccNum)) upsertRow.country_code = ccNum;

    const { error: upErr } = await sb.from("users").upsert(upsertRow, { onConflict: "id" });
    if (upErr) throw upErr;

    // optional: auto-link crew record by email
    try { await fetch("/api/crew/auto-link", { method: "POST" }); } catch {}

    // cache + redirect
    await cachePsUser();
    try { localStorage.removeItem("next_after_login"); } catch {}
    goNext(nextUrl);
  } catch (err: any) {
    setMsg(String(err?.message || err) || "Sign up failed");
  } finally {
    setWorking(false);
  }
}

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">
        {mode === "login" ? "Log in" : "Create an account"}
      </h1>

      <div className="mt-3 text-sm">
        {mode === "login" ? (
          <>
            Don’t have an account?{" "}
            <button type="button" className="text-blue-600 underline" onClick={() => { setMode("signup"); setMsg(null); }}>
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button type="button" className="text-blue-600 underline" onClick={() => { setMode("login"); setMsg(null); }}>
              Log in
            </button>
          </>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-neutral-700">Checking session…</p>
      ) : mode === "login" ? (
        <form className="mt-6 space-y-4" onSubmit={onLogin}>
          <label className="block">
            <span className="text-sm text-neutral-700">Email</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="block">
            <span className="text-sm text-neutral-700">Password</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <button className="rounded-lg bg-neutral-900 text-white px-4 py-2 disabled:opacity-50" disabled={working}>
            {working ? "Signing in…" : "Log in"}
          </button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={onSignup}>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-neutral-700">First name</span>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm text-neutral-700">Last name</span>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-neutral-700">Email</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-neutral-700">Mobile</span>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="block">
              <span className="text-sm text-neutral-700">Country code</span>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm text-neutral-700">Password</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          <label className="block">
            <span className="text-sm text-neutral-700">Confirm password</span>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>

          {msg && <p className="text-sm text-red-600">{msg}</p>}

          <button className="rounded-lg bg-neutral-900 text-white px-4 py-2 disabled:opacity-50" disabled={working}>
            {working ? "Creating…" : "Create account"}
          </button>
        </form>
      )}
    </div>
  );
}
