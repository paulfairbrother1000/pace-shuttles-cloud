// /lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * RLS-aware Supabase client (uses the user's cookies).
 * Call this inside Route Handlers / Server Components per request.
 */
export function supabaseServer(): SupabaseClient {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error("Supabase env (URL/ANON) missing");

  const cookieStore = cookies();

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // no-op on edge/runtime limitations
        }
      },
      remove(name: string, options: any) {
        try {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        } catch {
          // no-op on edge/runtime limitations
        }
      },
    },
  });
}

/**
 * Non-RLS (admin) Supabase client using the SERVICE ROLE key.
 * NEVER import this in any client component.
 * Use for server-only tasks (API routes, cron, webhooks).
 */
export function supabaseService(): SupabaseClient {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("Supabase env (URL/SERVICE) missing");

  return createClient(url, serviceKey, {
    auth: {
      // avoid any accidental cookie/session persistence server-side
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Optional convenience export for places that just need the admin client. */
// export const sbAdmin = supabaseService();
