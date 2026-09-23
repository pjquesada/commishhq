import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
export async function createClient() {
  const env = publicEnv();
  if (!env.success) throw new Error("Supabase is not configured");
  const store = await cookies();
  return createServerClient(env.data.url, env.data.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components cannot write cookies; proxy refreshes sessions. */
        }
      },
    },
  });
}
