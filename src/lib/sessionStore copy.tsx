"use client";
import React from "react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useSessionState() {
  return {
    ready: true,
    userId: null,
    email: null,
    siteAdmin: false,
    operatorAdmin: false,
    operatorId: null,
    locked: false,
    setOperatorId: (_id: string | null) => {},
  };
}
