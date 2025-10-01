"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Country = { code: string; name: string; int_code: number | null };

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Email + password validators
function isValidEmail(email: string): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function validatePassword(pw: string) {
  const errors: string[] = [];
  if (!pw) errors.push("Password is required.");
  else {
    if (pw.length < 8) errors.push("Must be at least 8 characters.");
    if (pw.length > 64) errors.push("Must be at most 64 characters.");
    if (pw.trim() !== pw) errors.push("No leading or trailing spaces.");
    const hasLower = /[a-z]/.test(pw);
    const hasUpper = /[A-Z]/.test(pw);
    const hasDigit = /\d/.test(pw);
    const hasSymbol = /[^A-Za-z0-9]/.test(pw);
    if ([hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length < 3) {
      errors.push("Include at least three of: lowercase, uppercase, number, symbol.");
    }
    const bad = ["password", "12345678", "qwertyui", "letmein", "iloveyou"];
    if (bad.includes(pw.toLowerCase())) errors.push("Password is too common.");
  }
  return { ok: errors.length === 0, errors };
}

export default function SignupPage() {
  // countries
  const [countries, setCountries] = useState<Country[]>([]);
  const [loadingCountries, setLoadingCountries] = useState(true);

  // form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  // Store dial code as STRING in state (so <select> matches correctly)
  const [countryCode, setCountryCode] = useState<string>("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // inline errors
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pwErrors, setPwErrors] = useState<string[]>([]);
  const [pw2Error, setPw2Error] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoadingCountries(true);
      const { data, error } = await sb
        .from("un_countries")
        .select("code,name,int_code")
        .order("name");
      if (off) return;
      if (error) setMsg(error.message);
      setCountries((data as Country[]) ?? []);
      setLoadingCountries(false);
    })();
    return () => { off = true; };
  }, []);

  // live validation
  useEffect(() => {
    if (!email.trim()) setEmailError(null);
    else setEmailError(isValidEmail(email) ? null : "Invalid email format.");
  }, [email]);

  useEffect(() => {
    const v = validatePassword(password);
    setPwErrors(v.ok ? [] : v.errors);
  }, [password]);

  useEffect(() => {
    if (!password2) setPw2Error(null);
    else setPw2Error(password2 === password ? null : "Passwords do not match.");
  }, [password, password2]);

  useEffect(() => {
    const hasMobile = mobile.trim().length > 0;
    const hasCode = countryCode !== "";
    if (!hasMobile && !hasCode) setMobileError(null);
    else if (hasMobile && hasCode) setMobileError(null);
    else setMobileError("Provide both dial code and mobile number.");
  }, [mobile, countryCode]);

  // Auto-split when user pastes/types +<code> into Mobile
  const splitOnceRef = useRef(false);
  useEffect(() => {
    if (!countries.length) return;
    const m = mobile.trim();

    if (!m.startsWith("+")) {
      splitOnceRef.current = false; // reset if user removes '+'
      return;
    }
    if (splitOnceRef.current) return;

    const digits = m.replace(/\D+/g, "");
    if (!digits) return;

    const codes = countries
      .map((c) => (c.int_code != null ? String(c.int_code) : ""))
      .filter(Boolean);

    const match =
      codes
        .filter((code) => digits.startsWith(code))
        .sort((a, b) => b.length - a.length)[0] || "";

    if (match) {
      if (countryCode !== match) setCountryCode(match);
      const rest = digits.slice(match.length);
      if (rest && rest !== mobile) {
        setMobile(rest);
        splitOnceRef.current = true;
      }
    }
  }, [mobile, countries, countryCode]);

  const canSubmit = useMemo(() => {
    const okEmail = email.trim() ? isValidEmail(email) && !emailError : false;
    const okMobilePair = mobile.trim().length > 0 && countryCode !== "" && !mobileError;
    if (!okEmail && !okMobilePair) return false;
    if (pwErrors.length > 0) return false;
    if (password2 !== password) return false;
    return true;
  }, [email, emailError, mobile, countryCode, mobileError, pwErrors, password2, password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!canSubmit) {
      setMsg("Please fix the errors and try again.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          email: email.trim() || null,
          // convert to number for the API (DB stores the int only)
          country_code: countryCode === "" ? null : Number(countryCode),
          mobile: mobile.trim() ? Number(mobile.replace(/\D+/g, "")) : null,
          password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body?.error || `Sign up failed (${res.status})`);
        return;
      }
      setMsg("Account created ✅");
      // window.location.href = "/login";
    } catch (err: any) {
      setMsg(err?.message ?? "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Create your account</h1>
      <p className="text-neutral-600 mb-6">You can sign up with an email, mobile number, or both.</p>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow">
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">First name</label>
              <input className="w-full border rounded-lg px-3 py-2" value={firstName}
                     onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Last name</label>
              <input className="w-full border rounded-lg px-3 py-2" value={lastName}
                     onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">Email (optional)</label>
            <input type="email" className="w-full border rounded-lg px-3 py-2"
                   placeholder="you@example.com" value={email}
                   onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            {emailError && <p className="text-xs text-red-600 mt-1">{emailError}</p>}
          </div>

          <div className="grid grid-cols-[14rem,1fr] gap-3">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Dial code (optional)</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={countryCode}                                  // string state
                onChange={(e) => setCountryCode(e.target.value)}      // set as string
                disabled={loadingCountries}
              >
                <option value="">— Code —</option>
                {countries.map((c) => (
                  <option
                    key={c.code}
                    value={c.int_code != null ? String(c.int_code) : ""}
                    disabled={!c.int_code}
                  >
                    {c.name}{c.int_code ? ` +${c.int_code}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Mobile (optional)</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="numeric"
                     placeholder="777123456" value={mobile}
                     onChange={(e) => setMobile(e.target.value)} autoComplete="tel" />
              {mobileError && <p className="text-xs text-red-600 mt-1">{mobileError}</p>}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Password</label>
              <input type="password" className="w-full border rounded-lg px-3 py-2"
                     value={password} onChange={(e) => setPassword(e.target.value)}
                     autoComplete="new-password" />
              {pwErrors.length > 0 && (
                <ul className="mt-1 text-xs text-red-600 list-disc pl-4 space-y-0.5">
                  {pwErrors.map((er) => <li key={er}>{er}</li>)}
                </ul>
              )}
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Confirm password</label>
              <input type="password" className="w-full border rounded-lg px-3 py-2"
                     value={password2} onChange={(e) => setPassword2(e.target.value)}
                     autoComplete="new-password" />
              {pw2Error && <p className="text-xs text-red-600 mt-1">{pw2Error}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={!canSubmit || submitting}
                    className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50">
              {submitting ? "Creating…" : "Create account"}
            </button>
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>

          <div className="text-sm text-neutral-600">
            Already have an account? <a href="/login" className="underline">Sign in</a>.
          </div>
        </form>
      </section>
    </div>
  );
}
