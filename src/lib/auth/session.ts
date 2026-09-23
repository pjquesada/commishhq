import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export const currentUser = cache(async () => {
  if (!publicEnv().success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
