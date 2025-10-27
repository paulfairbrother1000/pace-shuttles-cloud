"use client";

import React from "react";
import * as M from "@/components/support/ChatPanelWrapper";

/** Always return a real component, even if the source has only named exports. */
const Base =
  (M as any).default ??
  (M as any).ChatPanelWrapper ??
  (() => <div className="text-sm text-[#a3b3cc]">Chat panel not available.</div>);

const ChatPanelWrapperDynamic: React.ComponentType<any> = Base;

export default function ChatPanelWrapperBridge(props: any) {
  const C = ChatPanelWrapperDynamic;
  return <C {...props} />;
}
