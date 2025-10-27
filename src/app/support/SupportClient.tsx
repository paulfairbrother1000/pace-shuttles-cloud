// src/app/support/SupportClient.tsx
"use client";

import dynamic from "next/dynamic";
import React from "react";

// Robust to default OR named exports; no ssr flag needed in a client component
const ChatPanelWrapper = dynamic(
  () =>
    import("@/components/support/ChatPanelWrapper").then(
      (m) => m.default ?? m.ChatPanelWrapper
    )
);
const TicketListWrapper = dynamic(
  () =>
    import("@/components/support/TicketListWrapper").then(
      (m) => m.default ?? m.TicketListWrapper
    )
);
const CreateTicketForm = dynamic(
  () =>
    import("@/components/support/CreateTicketForm").then(
      (m) => m.default ?? m.CreateTicketForm
    )
);

export default function SupportClient() {
  return (
    <>
      {/* Client-only chat */}
      <div className="mt-4">
        <ChatPanelWrapper mode="signed" />
      </div>

      {/* Tickets list (fetch inside the wrapper client-side) */}
      <div className="mt-4">
        <TicketListWrapper title="My tickets" tickets={[]} />
      </div>

      {/* Create ticket */}
      <div id="create" className="mt-4">
        <CreateTicketForm />
      </div>
    </>
  );
}
