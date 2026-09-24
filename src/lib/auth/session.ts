import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { safeNext } from "./validation";
import { createClient } from "@/lib/supabase/server";
export const currentUser = cache(async () => {
  if (!publicEnv().success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});
export async function requireUser(next = "/") {
  const user = await currentUser();
  if (!user)
    redirect(
      next === "/"
        ? "/login"
        : `/login?next=${encodeURIComponent(safeNext(next))}`,
    );
  return user;
}
