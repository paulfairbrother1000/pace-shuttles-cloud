// /src/app/login/page.tsx
"use client";

import { useState } from "react";

type LoginResp = {
  ok: boolean;
  redirectTo?: string;
  user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    mobile: string | null;
    country_code: number | null;
    site_admin: boolean;
    operator_admin: boolean;
    operator_id: string | null;
  };
  error?: string;
};

function setCookie(name: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 7) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "email",
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const j: LoginResp = await res.json();

      if (!res.ok || !j.ok || !j.user) {
        setErr(j.error || "Invalid login credentials");
        setBusy(false);
        return;
      }

      // Store the single source of truth the header/account read
      const ps_user = {
        id: j.user.id,
        first_name: j.user.first_name,
        last_name: j.user.last_name,
        email: j.user.email,
        mobile: j.user.mobile,
        country_code: j.user.country_code,
        site_admin: !!j.user.site_admin,
        operator_admin: !!j.user.operator_admin,
        operator_id: j.user.operator_id,
      };
      try {
        localStorage.setItem("ps_user", JSON.stringify(ps_user));
        localStorage.setItem("uid", j.user.id);
      } catch {}

      // Keep legacy cookies for any server/layout checks
      clearCookie("site_admin");
      clearCookie("operator_admin");
      clearCookie("operator_id");
      setCookie("uid", j.user.id);
      setCookie("site_admin", String(j.user.site_admin));
      setCookie("operator_admin", String(j.user.operator_admin));
      if (j.user.operator_id) setCookie("operator_id", j.user.operator_id);

      // Hard redirect so menus/header refresh
      window.location.replace(j.redirectTo || "/");
    } catch (e: any) {
      setErr("Unexpected error during login.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Sign in</h1>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #ccc", marginTop: 6 }}
          />
        </label>

        <label style={{ display: "block", marginBottom: 16 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #ccc", marginTop: 6 }}
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            background: "#000",
            color: "#fff",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ marginTop: 16 }}>
        Don’t have an account? <a href="/signup">Create one</a>
      </p>

      {err && (
        <p style={{ marginTop: 12, color: "#b00020" }}>
          <strong>Error:</strong> {err}
        </p>
      )}
    </div>
  );
}
