"use client";

import dynamic from "next/dynamic";
import React from "react";

// Import the *shim* files dynamically (they always default-export a component)
const ChatPanelWrapper = dynamic(
  () => import("@/components/support/dynamic/ChatPanelWrapper.dynamic"),
  { loading: () => <div className="opacity-70 text-sm">Loading chat…</div> }
);

const TicketListWrapper = dynamic(
  () => import("@/components/support/dynamic/TicketListWrapper.dynamic"),
  { loading: () => <div className="opacity-70 text-sm">Loading tickets…</div> }
);

const CreateTicketForm = dynamic(
  () => import("@/components/support/dynamic/CreateTicketForm.dynamic"),
  { loading: () => <div className="opacity-70 text-sm">Loading form…</div> }
);

export default function SupportClient() {
  return (
    <>
      <div className="mt-4">
        <ChatPanelWrapper mode="signed" />
      </div>

      <div className="mt-4">
        <TicketListWrapper title="My tickets" tickets={[]} />
      </div>

      <div id="create" className="mt-4">
        <CreateTicketForm />
      </div>
    </>
  );
}
