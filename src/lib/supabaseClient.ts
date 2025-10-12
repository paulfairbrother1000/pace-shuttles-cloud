"use client";

import { createBrowserClient } from "@supabase/ssr";

export const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// expose for DevTools on any environment
if (typeof window !== "undefined") {
  (window as any).sb = sb;
  (globalThis as any).sb = sb;
}
