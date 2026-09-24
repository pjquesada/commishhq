import { z } from "zod";

const httpUrl = z
  .url()
  .refine((value) => ["https:", "http:"].includes(new URL(value).protocol));

export const publicEnvSchema = z.object({
  url: httpUrl,
  key: z.string().min(1),
});

export const serverAdminEnvSchema = z.object({
  url: httpUrl,
  key: z.string().min(1),
});

export function publicEnv() {
  return publicEnvSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function serverAdminEnv() {
  return serverAdminEnvSchema.safeParse({
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key:
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
