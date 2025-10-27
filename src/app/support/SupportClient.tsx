"use client";

import React from "react";
import ChatPanelWrapper from "@/components/support/ChatPanelWrapper";
import TicketListWrapper from "@/components/support/TicketListWrapper";
import CreateTicketForm from "@/components/support/CreateTicketForm";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

export default function SupportClient() {
  return (
    <>
      <div className="mt-4">
        <ChatPanelWrapper mode="signed" />
      </div>

      <div className="mt-4">
        <TicketListWrapper title="My tickets" />
      </div>

      <Card id="create" className="mt-4">
        <CardHeader>
          <h3 className="font-semibold">Create a ticket</h3>
        </CardHeader>
        <CardContent>
          <CreateTicketForm />
        </CardContent>
      </Card>
    </>
  );
}
