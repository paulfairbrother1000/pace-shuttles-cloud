// /lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

/** Use this in Route Handlers/pages that should respect the user's session & RLS */
export function supabaseServer() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !anon) throw new Error("Supabase env (URL/ANON) missing");

  return createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try { cookieStore.set({ name, value, ...options }); } catch {}
      },
      remove(name: string, options: any) {
        try { cookieStore.set({ name, value: "", ...options, maxAge: 0 }); } catch {}
      },
    },
  });
}

/** Use ONLY for backend tasks that must bypass RLS (cron, webhooks). Never expose to client. */
export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("Supabase env (URL/SERVICE) missing");
  return createClient(url, serviceKey);
}
