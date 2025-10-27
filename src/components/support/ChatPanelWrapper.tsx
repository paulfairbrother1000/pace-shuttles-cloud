// src/components/support/ChatPanelWrapper.tsx
"use client";

import dynamic from "next/dynamic";

// Load the actual chat panel only on the client
const ChatPanel = dynamic(() => import("@/components/support/ChatPanel"), { ssr: false });

export default function ChatPanelWrapper(props: any) {
  return <ChatPanel {...props} />;
}
