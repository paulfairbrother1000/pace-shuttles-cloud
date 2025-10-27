// src/components/support/ChatPanelWrapper.tsx
"use client";
import React from "react";

const enabled = (process.env.NEXT_PUBLIC_AGENT_ENABLED || "").toLowerCase() === "true";

export default function ChatPanelWrapper({ mode }: { mode: "signed" | "guest" }) {
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-[color-mix(in_oklab,_#0f1a2a_70%,_white_14%)] bg-[color-mix(in_oklab,_#0f1a2a_85%,_white_6%)] p-4">
        <p className="text-[#eaf2ff] font-medium mb-1">Chat will be available here.</p>
        <p className="text-sm text-[#a3b3cc]">
          You can still ask questions about destinations, journeys and pickups. When you sign in,
          I can also help with your bookings and account.
        </p>
      </div>
    );
  }

  return <ChatWindow />; // real agent UI (below)
}
