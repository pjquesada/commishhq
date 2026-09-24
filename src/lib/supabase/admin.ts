import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverAdminEnv } from "@/lib/env";
export function adminConfigured() {
  return (
    publicEnv().success &&
    serverAdminEnv().success
  );
}
/** No cookies, session persistence or browser imports. Caller must authenticate/authorize first. */
export function createAdminClient() {
  const env = serverAdminEnv();
  if (!env.success)
    throw new Error("Server configuration is missing.");
  return createClient(env.data.url, env.data.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
