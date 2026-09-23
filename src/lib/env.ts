import { z } from "zod";
export const publicEnvSchema = z.object({
  url: z
    .url()
    .refine((value) => ["https:", "http:"].includes(new URL(value).protocol)),
  key: z.string().min(1),
});
export function publicEnv() {
  return publicEnvSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
