"use client";

import { useState } from "react";
import supabaseClient from "@/lib/supabaseClient"; // ← default import

// If your @ alias isn't working, use a relative import instead:
// import supabaseClient from "../../lib/supabaseClient";

export default function DebugLogin() {
  const [email, setEmail] = useState("paul@paul.com");
  const [password, setPassword] = useState("");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function doLogin() {
    setErr(null); setOut(null); setBusy(true);
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOut(data ?? null);
  }

  async function whoami() {
    setErr(null); setOut(null); setBusy(true);
    const { data, error } = await supabaseClient.auth.getUser();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOut(data ?? null);
  }

  async function signOut() {
    setErr(null); setOut(null); setBusy(true);
    const { error } = await supabaseClient.auth.signOut();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOut({ ok: true, signedOut: true });
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Debug Login</h1>
      <label className="block text-sm">Email</label>
      <input className="w-full border p-2 rounded" value={email} onChange={e=>setEmail(e.target.value)} />
      <label className="block text-sm">Password</label>
      <input className="w-full border p-2 rounded" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <div className="flex gap-2 pt-2">
        <button className="border px-3 py-2 rounded" onClick={doLogin} disabled={busy}>Login</button>
        <button className="border px-3 py-2 rounded" onClick={whoami} disabled={busy}>Who am I?</button>
        <button className="border px-3 py-2 rounded" onClick={signOut} disabled={busy}>Sign out</button>
      </div>
      <div className="pt-2">
        <a className="underline text-blue-600" href="/account">Go to Account</a>
      </div>
      {err && <pre className="text-red-600 whitespace-pre-wrap">{err}</pre>}
      {out && <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(out, null, 2)}</pre>}
    </div>
  );
}
