// src/app/chat/page.tsx
"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import NextDynamic from "next/dynamic";

// Load lightweight client chat ONLY on the client (when no external embed)
const ChatClient = NextDynamic(() => import("@/components/chat/ChatClient"), { ssr: false });

function readPsUser() {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("ps_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const [psUser, setPsUser] = React.useState<any | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setPsUser(readPsUser());
    setReady(true);
    const onUpd = () => setPsUser(readPsUser());
    window.addEventListener("ps_user:updated", onUpd);
    return () => window.removeEventListener("ps_user:updated", onUpd);
  }, []);

  const name =
    psUser?.first_name ||
    (psUser?.email ? String(psUser.email).split("@")[0] : "") ||
    "Guest";

  // OPTIONAL: if you later wire Zammad Widget/Embed, gate by env vars here
  const zammadUrl = process.env.NEXT_PUBLIC_ZAMMAD_URL;
  const hasEmbed = !!zammadUrl; // or any condition you need

  return (
    <main className="ps-theme min-h-screen bg-app text-app">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-3xl font-extrabold">Chat</h1>
        <p className="mt-2 text-sm opacity-80">
          {ready ? `Signed in as ${name}` : "Loading…"}
        </p>

        <div className="mt-6">
          {hasEmbed ? (
            // TODO: drop your real chat embed/widget here (client only)
            <div className="rounded-xl border border-neutral-800 p-4">
              Your chat widget goes here (Zammad/…).
            </div>
          ) : (
            // Minimal fallback chat UI that posts to /api/agent and uses your RAG + guardrails
            <ChatClient />
          )}
        </div>
      </div>
    </main>
  );
}
