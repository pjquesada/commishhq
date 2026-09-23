import { z } from "zod";
export const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
  captchaToken: z.string().max(4096).optional(),
});
export function safeNext(value: string | null): string {
  if (!value || !/^\/(?!\/)/.test(value) || /[\\\x00-\x20]/.test(value))
    return "/";
  return value;
}
