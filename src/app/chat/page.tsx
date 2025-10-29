// src/app/chat/page.tsx
"use client";

import AgentChat from "@/components/AgentChat";

export default function ChatPage() {
  return (
    <main style={{ padding: 16 }}>
      <AgentChat endpoint="/api/agent" title="Pace Shuttles Assistant" />
    </main>
  );
}
