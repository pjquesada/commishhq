import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverAdminEnv } from "@/lib/env";

export function createAdminClient() {
  const env = serverAdminEnv();
  if (!env.success) throw new Error("Supabase admin access is not configured");

  return createClient(env.data.url, env.data.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
