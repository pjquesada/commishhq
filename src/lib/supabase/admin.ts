import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
export function adminConfigured() {
  return (
    publicEnv().success &&
    Boolean(
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  );
}
/** No cookies, session persistence or browser imports. Caller must authenticate/authorize first. */
export function createAdminClient() {
  const env = publicEnv();
  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.success || !secret)
    throw new Error("Server configuration is missing.");
  return createClient(env.data.url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
