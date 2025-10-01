// /src/app/_debug/login/page.tsx
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
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}
function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}
function clearAllCookies() {
  document.cookie.split(";").forEach((c) => {
    const i = c.indexOf("=");
    const name = (i > -1 ? c.slice(0, i) : c).trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  });
}
function readCookies(): Record<string, string> {
  const out: Record<string, string> = {};
  document.cookie.split(";").forEach((c) => {
    const [k, ...rest] = c.split("=");
    if (!k) return;
    out[k.trim()] = decodeURIComponent(rest.join("=").trim());
  });
  return out;
}

export default function DebugLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stayHere, setStayHere] = useState(false); // redirect by default so header refreshes
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<any>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setDiag(null);
    setBusy(true);

    try {
      const body = {
        mode: "email",
        email: email.trim().toLowerCase(),
        password,
      };

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j: LoginResp = await res.json();

      if (!res.ok || !j.ok || !j.user) {
        setBusy(false);
        setErr(j.error || "Invalid login credentials");
        setDiag({ step: "POST /api/login", status: res.status, body: j });
        return;
      }

      // 1) Update localStorage.ps_user — this is what SiteHeader reads.
      const ps_user = {
        id: j.user.id,
        first_name: j.user.first_name,
        last_name: j.user.last_name,
        email: j.user.email,
        mobile: j.user.mobile,
        country_code: j.user.country_code,
        site_admin: !!j.user.site_admin,
        operator_admin: !!j.user.operator_admin,
        // header doesn't use operator_id, but keep it available for the app:
        operator_id: j.user.operator_id,
      };
      try {
        localStorage.setItem("ps_user", JSON.stringify(ps_user));
      } catch {}

      // 2) Keep legacy cookies in case other code relies on them
      clearCookie("site_admin");
      clearCookie("operator_admin");
      clearCookie("operator_id");

      setCookie("uid", j.user.id);
      setCookie("site_admin", String(j.user.site_admin));         // "true"/"false"
      setCookie("operator_admin", String(j.user.operator_admin)); // "true"/"false"
      if (j.user.operator_id) setCookie("operator_id", j.user.operator_id);

      const afterCookies = readCookies();

      // 3) Diagnostics: include operator_admin & operator_id + cookies
      const payload = {
        step: "login-complete",
        status: 200,
        body: {
          user_id: j.user.id,
          email: j.user.email,
          site_admin: j.user.site_admin,
          operator_admin: j.user.operator_admin,
          operator_id: j.user.operator_id,
          cookies_after_set: afterCookies,
          ps_user, // shows exactly what SiteHeader will read
        },
      };

      setBusy(false);

      if (stayHere) {
        setDiag(payload);
        // Note: storage events don't fire in the same tab automatically.
        // If you really want live update without reload, uncomment:
        // window.dispatchEvent(new StorageEvent("storage", { key: "ps_user", newValue: JSON.stringify(ps_user) }));
      } else {
        // Hard redirect so server-side/headers recompute and menus appear.
        window.location.replace(j.redirectTo || "/");
      }
    } catch (e: any) {
      setBusy(false);
      setErr("Unexpected error during login.");
      setDiag({ step: "exception", error: String(e) });
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setErr(null);
    try {
      try {
        localStorage.removeItem("ps_user");
        localStorage.removeItem("uid");
        sessionStorage.clear();
      } catch {}
      clearAllCookies();
      window.location.replace("/"); // force header/layout recompute
    } catch (e: any) {
      setErr("Sign out failed.");
      setDiag({ step: "signOut", status: "error", error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 24 }}>Sign in</h1>
        <button
          onClick={handleSignOut}
          disabled={busy}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ccc", background: "#f7f7f7", cursor: "pointer" }}
          title="Clear current cookies/storage and hard reload"
        >
          Sign out (debug)
        </button>
      </header>

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

        <label style={{ display: "block", marginBottom: 8 }}>
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

        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 20px" }}>
          <input type="checkbox" checked={stayHere} onChange={(e) => setStayHere(e.target.checked)} />
          Stay on this page (show diagnostics, don’t redirect)
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
        <div style={{ marginTop: 16, color: "#b00020" }}>
          <strong>Error:</strong> {err}
        </div>
      )}

      {diag && (
        <details open style={{ marginTop: 24 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hide Diagnostics</summary>
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: "#111",
              color: "#0f0",
              overflow: "auto",
            }}
          >
{JSON.stringify(diag, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
