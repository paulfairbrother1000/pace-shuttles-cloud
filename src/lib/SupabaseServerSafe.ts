// src/lib/supabaseServerSafe.ts
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/**
 * Safe server client:
 * - No top-level cookies() calls
 * - Returns a stub if env vars are missing
 * - Never throws during SSR/build
 */
export function getSupabaseServerSafe() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // If env not set, behave as signed-out instead of throwing
    if (!url || !key) {
      return {
        auth: {
          async getUser() {
            return { data: { user: null }, error: null } as const;
          },
        },
      } as any;
    }

    // All request-scoped access happens inside the function
    const store = cookies();
    return createServerClient(url, key, {
      cookies: {
        get(name: string) {
          return store.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try { store.set({ name, value, ...options }); } catch {}
        },
        remove(name: string, options: CookieOptions) {
          try { store.set({ name, value: "", ...options }); } catch {}
        },
      },
    });
  } catch {
    // Fallback stub
    return {
      auth: {
        async getUser() {
          return { data: { user: null }, error: null } as const;
        },
      },
    } as any;
  }
}
