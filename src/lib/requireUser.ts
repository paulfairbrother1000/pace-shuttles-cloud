// src/lib/requireUser.ts
import { supabaseServer } from "@/lib/supabaseServer";

export type AuthedUser = {
  id: string;
  email: string;
};

export async function requireUser(): Promise<AuthedUser> {
  const supabase = supabaseServer();

  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;

  if (error || !user?.email) {
    // Your API routes can catch this and return 401
    throw new Error("AUTH_REQUIRED");
  }

  return { id: user.id, email: user.email };
}
