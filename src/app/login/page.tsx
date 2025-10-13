"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type PsUser = {
  first_name: string | null;
  site_admin: boolean | null;
  operator_admin: boolean | null;
  operator_id: string | null;
};

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

  /** Ensure a row exists in public.users for the current auth user. */
  const ensureUsersRow = React.useCallback(
    async (extras?: Partial<Record<string, any>>) => {
      const { data: ures, error: uErr } = await sb.auth.getUser();
      if (uErr || !ures?.user) return null;
      const u = ures.user;

      // 1) Try to read by auth_user_id (correct join key for your schema)
      const { data: existing, error: readErr } = await sb
        .from("users")
        .select("id, first_name, site_admin, operator_admin, operator_id")
        .eq("auth_user_id", u.id)
        .limit(1)
        .maybeSingle();

      if (!readErr && existing) return existing;

      // 2) If not found, insert one
      const payload: Record<string, any> = {
        auth_user_id: u.id,
        email: u.email ?? null,
        first_name: extras?.first_name ?? null,
        last_name: extras?.last_name ?? null,
      };

      const { data: inserted, error: insErr } = await sb
        .from("users")
        .insert(payload)
        .select("id, first_name, site_admin, operator_admin, operator_id")
        .single();

      if (insErr) throw insErr;
      return inserted;
    },
    []
  );

  /** Cache the lightweight user record for header/menu. */
  const cachePsUser = React.useCallback(async () => {
    try {
      const ensured = await ensureUsersRow();
      if (ensured) {
        const ps: PsUser = {
          first_name: ensured.first_name ?? null,
          site_admin: ensured.site_admin ?? null,
          operator_admin: ensured.operator_admin ?? null,
          operator_id: ensured.operator_id ?? null,
        };
        localStorage.setItem("ps_user", JSON.stringify(ps));
      } else {
        localStorage.removeItem("ps_user");
      }
    } catch {
      localStorage.removeItem("ps_user");
    }
  }, [ensureUsersRow]);

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
        await cachePsUser();
        goNext(nextUrl);
      } else {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [goNext, nextUrl, cachePsUser]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setWorking(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      await ensureUsersRow();       // make sure users row exists
      await cachePsUser();
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

    // basic validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setMsg("Please enter a valid email address."); return; }
    if (!firstName.trim() || !lastName.trim()) { setMsg("Please provide first and last name."); return; }
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setMsg("Passwords do not match."); return; }

    setWorking(true);
    try {
      const { error: signUpErr } = await sb.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
      });
      if (signUpErr) { setMsg(signUpErr.message || "Sign up failed"); setWorking(false); return; }

      // Some projects won’t return a session on signUp; ensure we have one:
      let { data: sess } = await sb.auth.getSession();
      if (!sess?.session) {
        const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
        if (loginErr) { setMsg(loginErr.message || "Sign in failed after sign up"); setWorking(false); return; }
      }

      // Create users row if missing and enrich with phone/country
      const mobileNum = mobile.trim() ? Number(mobile.trim()) : null;
      const ccNum = countryCode.trim() ? Number(countryCode.trim()) : null;

      const usersRow = await ensureUsersRow({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });

      if (usersRow) {
        const update: Record<string, any> = {};
        if (mobileNum && Number.isFinite(mobileNum)) update.mobile = mobileNum;
        if (ccNum && Number.isFinite(ccNum)) update.country_code = ccNum;

        if (Object.keys(update).length) {
          // Update by auth_user_id, not id
          const { error: upErr } = await sb
            .from("users")
            .update(update)
            .eq("auth_user_id", (await sb.auth.getUser()).data.user?.id || "");
          if (upErr) console.warn("users update failed:", upErr.message);
        }
      }

      await cachePsUser();
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
