"use client";

import React from "react";

const enabled = (process.env.NEXT_PUBLIC_SUPPORT_CHAT_ENABLED || "").toLowerCase() === "true";

/**
 * Thin wrapper that either shows a helpful message or renders your future chat UI.
 * Flip NEXT_PUBLIC_SUPPORT_CHAT_ENABLED=true to reveal the chat panel area.
 */
export default function ChatPanelWrapper({ mode }: { mode: "signed" | "guest" }) {
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_oklab,_#0f1a2a_70%,_white_14%)] bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_6%)] p-4">
        <p className="text-[#eaf2ff] font-medium mb-1">Live chat isn’t configured right now.</p>
        <p className="text-sm text-[#a3b3cc]">
          Please email{" "}
          <a className="underline text-[#9ec3ff]" href="mailto:hello@paceshuttles.com">
            hello@paceshuttles.com
          </a>{" "}
          or open a ticket below.
        </p>
      </div>
    );
  }

  // Placeholder for real chat UI — slot your provider widget here (Zammad, custom, etc.)
  return (
    <div className="rounded-2xl border border-[#375882] bg-[#0f1a2a] p-4">
      <div className="text-[#eaf2ff] font-semibold">Chat (prototype)</div>
      <div className="text-sm text-[#a3b3cc] mt-1">
        Hello {mode === "signed" ? "there" : "guest"} — wire your chat provider here.
      </div>
    </div>
  );
}
