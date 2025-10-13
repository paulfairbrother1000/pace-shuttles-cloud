"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** Create/refresh the row in public.users for the current auth user, then cache ps_user and auto-link staff. */
async function syncUserRowAndCache() {
  try {
    const { data: ures } = await sb.auth.getUser();
    const u = ures?.user;
    if (!u) return;

    const email = (u.email || "").trim() || null;
    const metaFirst = (u.user_metadata?.first_name || "").trim();
    const metaLast = (u.user_metadata?.last_name || "").trim();

    // IMPORTANT: upsert on the real unique key that exists ("id").
    // The previous "onConflict: 'id,auth_user_id'" crashes because there is
    // no composite unique index on (id, auth_user_id).
    await sb.from("users").upsert(
      {
        id: u.id,
        auth_user_id: u.id,
        email,
        first_name: metaFirst || null,
        last_name: metaLast || null,
      },
      { onConflict: "id" }
    );

    // Read compact header payload; try id, then auth_user_id fallback.
    let me = await sb
      .from("users")
      .select("first_name, site_admin, operator_admin, operator_id")
      .eq("id", u.id)
      .maybeSingle();

    if (me.error || !me.data) {
      me = await sb
        .from("users")
        .select("first_name, site_admin, operator_admin, operator_id")
        .eq("auth_user_id", u.id)
        .maybeSingle();
    }

    if (me.data) {
      localStorage.setItem("ps_user", JSON.stringify(me.data));
    } else {
      localStorage.removeItem("ps_user");
    }

    // Non-blocking: auto-link any operator_staff with same email.
    try {
      await fetch("/api/crew/auto-link", { method: "POST" });
    } catch (e) {
      console.warn("auto-link failed (non-blocking):", e);
    }
  } catch (e) {
    console.warn("syncUserRowAndCache() failed:", e);
  }
}

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
  const [info, setInfo] = React.useState<string | null>(null); // non-error banner
  const [loading, setLoading] = React.useState(true);
  const [working, setWorking] = React.useState(false);

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
        await syncUserRowAndCache();
        goNext(nextUrl);
      } else {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [goNext, nextUrl]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setInfo(null);
    setWorking(true);
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      await syncUserRowAndCache();
      try { localStorage.removeItem("next_after_login"); } catch {}
      goNext(nextUrl);
    } catch (err: any) {
      const m = String(err?.message || "");
      setMsg(
        /email/i.test(m) && /confirm/i.test(m)
          ? "Please verify your email address to continue."
          : m || "Invalid login credentials"
      );
    } finally {
      setWorking(false);
    }
  }

  async function onSignup(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setInfo(null);

    // Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setMsg("Please enter a valid email address."); return; }
    if (!firstName.trim() || !lastName.trim()) { setMsg("Please provide first and last name."); return; }
    if (password.length < 6) { setMsg("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setMsg("Passwords do not match."); return; }

    setWorking(true);
    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName.trim(), last_name: lastName.trim() },
        },
      });
      if (error) throw error;

      // If email confirmations are ON, Supabase won't create a session here.
      // Show a clear instruction and DO NOT redirect.
      const sessionNow = (await sb.auth.getSession()).data.session;
      if (!sessionNow) {
        setInfo(
          "Account created. Please check your email and confirm your address to finish setup."
        );
        return; // stop here; user will come back via login
      }

      // If a session exists (confirmations OFF), finish the usual flow:
      // optional extra fields → users, then cache + redirect.
      const u = sessionNow.user;
      try {
        const mobileNum = mobile.trim() ? Number(mobile.trim()) : null;
        const ccNum = countryCode.trim() ? Number(countryCode.trim()) : null;
        const update: Record<string, any> = {
          id: u.id,
          auth_user_id: u.id,
          first_name: firstName.trim(),
          last_name : lastName.trim(),
          email,
        };
        if (mobileNum && Number.isFinite(mobileNum)) update.mobile = mobileNum;
        if (ccNum && Number.isFinite(ccNum)) update.country_code = ccNum;
        await sb.from("users").upsert(update, { onConflict: "id" });
      } catch (e) {
        console.warn("post-signup users upsert failed:", e);
      }

      await syncUserRowAndCache();
      goNext(nextUrl);
    } catch (err: any) {
      console.error("signup error:", err);
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
            <button type="button" className="text-blue-600 underline" onClick={() => { setMode("signup"); setMsg(null); setInfo(null); }}>
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button type="button" className="text-blue-600 underline" onClick={() => { setMode("login"); setMsg(null); setInfo(null); }}>
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
          {info && <p className="text-sm text-green-700">{info}</p>}
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
          {info && <p className="text-sm text-green-700">{info}</p>}

          <button className="rounded-lg bg-neutral-900 text-white px-4 py-2 disabled:opacity-50" disabled={working}>
            {working ? "Creating…" : "Create account"}
          </button>
        </form>
      )}
    </div>
  );
}
