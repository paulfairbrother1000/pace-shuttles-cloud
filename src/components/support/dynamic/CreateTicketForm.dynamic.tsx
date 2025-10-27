"use client";

import React from "react";
import * as M from "@/components/support/CreateTicketForm";

const Base =
  (M as any).default ??
  (M as any).CreateTicketForm ??
  (() => (
    <div className="text-sm text-[#a3b3cc]">
      Create Ticket form not available.
    </div>
  ));

const CreateTicketFormDynamic: React.ComponentType<any> = Base;

export default function CreateTicketFormBridge(props: any) {
  const C = CreateTicketFormDynamic;
  return <C {...props} />;
}
