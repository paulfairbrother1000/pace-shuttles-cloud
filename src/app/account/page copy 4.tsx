// src/app/account/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type PsUser = {
  first_name?: string | null;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
};

export default function AccountPage() {
  const [loading, setLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<PsUser | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Ensure there is a session
        const { data: sres } = await supabase.auth.getSession();
        const session = sres?.session ?? null;
        if (!session) {
          setAuthEmail(null);
          setProfile(null);
          return;
        }

        // Get the auth user (uid + email)
        const { data: ures, error: uerr } = await supabase.auth.getUser();
        if (uerr || !ures?.user) {
          throw new Error(uerr?.message || "No user");
        }
        const u = ures.user;
        setAuthEmail(u.email ?? null);

        // Tolerant DB read: try by id OR email, never .single()
        const { data, error } = await supabase
          .from("users")
          .select("first_name, site_admin, operator_admin, operator_id")
          .or(`id.eq.${u.id},email.eq.${u.email}`)
          .limit(1)
          .maybeSingle();

        if (off) return;

        if (error) {
          setErr(`Profile read failed: ${error.message}`);
          setProfile(null);
        } else {
          setProfile((data as PsUser) ?? null);
        }
      } catch (e: any) {
        if (!off) {
          setErr(e?.message ?? String(e));
          setProfile(null);
        }
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function refreshHeaderCache() {
    setCacheMsg(null);
    try {
      const { data: ures } = await supabase.auth.getUser();
      const u = ures?.user;
      if (!u) {
        setCacheMsg("Not signed in.");
        return;
      }

      const { data, error } = await supabase
          .from("users")
          .select("first_name, site_admin, operator_admin, operator_id")
          .or(`id.eq.${u.id},email.eq.${u.email}`)
          .limit(1)
          .maybeSingle();

      if (error) {
        setCacheMsg(`Cache not written: ${error.message}`);
        return;
      }
      if (data) {
        localStorage.setItem("ps_user", JSON.stringify(data));
        setProfile(data as PsUser);
        setCacheMsg("Header cache updated. Refresh the page to see menus.");
      } else {
        setCacheMsg("No matching users row to cache.");
      }
    } catch (e: any) {
      setCacheMsg(`Cache error: ${e?.message ?? String(e)}`);
    }
  }

  if (loading) return <div className="p-6">Loading account…</div>;

  if (!authEmail) {
    return (
      <div className="p-6 space-y-3">
        <div>You’re not signed in.</div>
        <a className="inline-block px-3 py-2 rounded bg-black text-white" href="/login">
          Go to Login
        </a>
      </div>
    );
  }

  const firstName =
    (profile?.first_name || "").trim() ||
    authEmail.split("@")[0];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Your account</h1>

      {err && <div className="text-red-600 text-sm">{err}</div>}

      <div className="rounded border p-4 bg-white space-y-1">
        <div><strong>Name:</strong> {firstName || "—"}</div>
        <div><strong>Email:</strong> {authEmail}</div>
        <div><strong>site_admin:</strong> {profile?.site_admin ? "true" : "false"}</div>
        <div><strong>operator_admin:</strong> {profile?.operator_admin ? "true" : "false"}</div>
        <div><strong>operator_id:</strong> {profile?.operator_id || "—"}</div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={refreshHeaderCache}
          className="px-3 py-2 rounded bg-neutral-800 text-white hover:bg-black"
        >
          Refresh header cache
        </button>
        {cacheMsg && <span className="text-sm text-neutral-700">{cacheMsg}</span>}
      </div>

      <button
        onClick={handleSignOut}
        className="px-3 py-2 rounded bg-neutral-800 text-white hover:bg-black"
      >
        Sign out
      </button>
    </div>
  );
}
