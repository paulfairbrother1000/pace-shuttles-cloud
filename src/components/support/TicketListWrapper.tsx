"use client";

import dynamic from "next/dynamic";

// Load TicketList only on the client, no SSR
const TicketList = dynamic(() => import("./TicketList"), { ssr: false });

export default function TicketListWrapper(
  props: React.ComponentProps<typeof TicketList>
) {
  return <TicketList {...props} />;
}
