"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { credentialsSchema } from "@/lib/auth/validation";
export type AuthState = { error?: string; message?: string };
export async function authenticate(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  if (!publicEnv().success)
    return { error: "Account access is not configured yet." };
  const parsed = credentialsSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    captchaToken: form.get("cf-turnstile-response") || undefined,
  });
  if (!parsed.success)
    return {
      error:
        "Enter a valid email and a password between 12 and 128 characters.",
    };
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !parsed.data.captchaToken)
    return { error: "Please complete the security check." };
  const supabase = await createClient();
  const { email, password, captchaToken } = parsed.data;
  if (form.get("mode") === "signup") {
    const origin = z.url().safeParse(process.env.APP_URL);
    if (!origin.success)
      return { error: "Account access is not configured yet." };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken,
        emailRedirectTo: new URL("/auth/callback", origin.data).toString(),
      },
    });
    if (error)
      return { error: "Unable to create an account. Please try again later." };
    return {
      message: "Check your email to confirm your account, then sign in.",
    };
  }
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error)
    return {
      error: "Unable to sign in. Check your details and email confirmation.",
    };
  redirect("/");
}
export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out. Please try again.");
  redirect("/login");
}
