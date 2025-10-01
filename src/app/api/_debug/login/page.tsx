"use client";

import { useState } from "react";
import supabaseClient from "@/lib/supabaseClient"; // ✅ default import (fixes red)

export default function DebugLogin() {
  const [email, setEmail] = useState("paul@paul.com");
  const [password, setPassword] = useState("");
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  async function doLogin() {
    setErr(null);
    setOut(null);
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setOut(data ?? null);
  }

  async function whoami() {
    setErr(null);
    setOut(null);
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) setErr(error.message);
    setOut(data ?? null);
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Debug Login</h1>
      <input className="w-full border p-2 rounded" value={email} onChange={e => setEmail(e.target.value)} placeholder="email" />
      <input className="w-full border p-2 rounded" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" type="password" />
      <div className="flex gap-2">
        <button className="border px-3 py-2 rounded" onClick={doLogin}>Login</button>
        <button className="border px-3 py-2 rounded" onClick={whoami}>Who am I?</button>
      </div>
      {err && <pre className="text-red-600 whitespace-pre-wrap">{err}</pre>}
      {out && <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(out, null, 2)}</pre>}
    </div>
  );
}
