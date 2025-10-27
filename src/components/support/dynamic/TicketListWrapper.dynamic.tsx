"use client";

import React from "react";
import * as M from "@/components/support/TicketListWrapper";

const Base =
  (M as any).default ??
  (M as any).TicketListWrapper ??
  ((p: any) => (
    <div className="text-sm text-[#a3b3cc]">
      Ticket list not available{p?.title ? ` — ${p.title}` : ""}.
    </div>
  ));

const TicketListWrapperDynamic: React.ComponentType<any> = Base;

export default function TicketListWrapperBridge(props: any) {
  const C = TicketListWrapperDynamic;
  return <C {...props} />;
}
