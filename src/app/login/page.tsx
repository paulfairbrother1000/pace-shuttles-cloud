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

  /** Ensure a row exists in public.users for this auth user, keyed by auth_user_id. */
  const ensureUsersRow = React.useCallback(
    async (opts?: { first?: string; last?: string; email?: string; mobile?: number | null; country_code?: number | null }) => {
      const { data: ures } = await sb.auth.getUser();
      const u = ures?.user;
      if (!u) return null;

      // Try find by auth_user_id
      const { data: existing } = await sb
        .from("users")
        .select("*")
        .eq("auth_user_id", u.id)
        .maybeSingle();

      const payload: Record<string, any> = {
        auth_user_id: u.id,
      };

      if (opts?.first) payload.first_name = opts.first;
      if (opts?.last) payload.last_name = opts.last;
      if (opts?.email ?? u.email) payload.email = (opts?.email ?? u.email) || null;
      if (typeof opts?.mobile !== "undefined") payload.mobile = opts.mobile;
      if (typeof opts?.country_code !== "undefined") payload.country_code = opts.country_code;

      if (existing) {
        // Update minimally
        await sb.from("users").update(payload).eq("auth_user_id", u.id);
      } else {
        // Insert new (let DB generate users.id)
        await sb.from("users").insert(payload);
      }

      // Return fresh row
      const { data: row } = await sb
        .from("users")
        .select("id, first_name, last_name, email, site_admin, operator_admin, operator_id")
        .eq("auth_user_id", u.id)
        .maybeSingle();

      return row ?? null;
    },
    []
  );

  /** Cache ps_user for menu/header */
  const cachePsUser = React.useCallback(async () => {
    try {
      const { data: ures } = await sb.auth.getUser();
      const u = ures?.user;
      if (!u) return;

      // Make sure users row exists, then cache
      const usersRow = await ensureUsersRow({
        first: (u.user_metadata as any)?.first_name,
        last: (u.user_metadata as any)?.last_name,
        email: u.email || undefined,
      });

      if (usersRow) {
        localStorage.setItem(
          "ps_user",
          JSON.stringify({
            id: usersRow.id,
            first_name: usersRow.first_name,
            site_admin: usersRow.site_admin,
            operator_admin: usersRow.operator_admin,
            operator_id: usersRow.operator_id,
          })
        );
      } else {
        localStorage.removeItem("ps_user");
      }
    } catch {
      // ignore
    }
  }, [ensureUsersRow]);

  async function afterAuthHousekeeping(extra?: { first?: string; last?: string }) {
    // 1) ensure public.users row and cache ps_user
    await ensureUsersRow({
      first: extra?.first,
      last: extra?.last,
      email,
      mobile: mobile.trim() ? Number(mobile.trim()) : null,
      country_code: countryCode.trim() ? Number(countryCode.trim()) : null,
    });
    await cachePsUser();

    // 2) auto-link crew record(s) by email → sets operator_staff.user_id
    try {
      await fetch("/api/crew/auto-link", { method: "POST" });
    } catch {
      /* non-fatal */
    }
  }

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
        await afterAuthHousekeeping();
        goNext(nextUrl);
      } else {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [goNext, nextUrl]); // afterAuthHousekeeping runs only on a logged-in session

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWorking(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      await afterAuthHousekeeping();
      try { localStorage.removeItem("next_after_login"); } catch {}
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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setMsg("Please enter a valid email address."); return; }
    if (!firstName.trim() || !lastName.trim()) { setMsg("Please provide first and last name."); return; }
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setMsg("Passwords do not match."); return; }

    setWorking(true);
    try {
      const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
      });
      if (error) throw error;

      // Create users row, link crew, cache ps_user
      await afterAuthHousekeeping({ first: firstName.trim(), last: lastName.trim() });

      goNext(nextUrl);
    } catch (err: any) {
      setMsg(err?.message || "Sign up failed");
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
