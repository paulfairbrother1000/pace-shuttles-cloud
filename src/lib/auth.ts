// src/lib/auth.ts
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function requireUser() {
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    throw new Error("AUTH_REQUIRED");
  }

  return {
    id: user.id,
    email: user.email,
  };
}
