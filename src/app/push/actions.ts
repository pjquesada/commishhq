"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { databaseError, uuidSchema } from "@/lib/leagues/models";

export type PushState = { error?: string; message?: string };

const subscriptionSchema = z.object({
  endpoint: z.url().refine((value) => value.startsWith("https://")),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(10).max(100),
});

export async function savePushSubscription(
  _state: PushState,
  form: FormData,
): Promise<PushState> {
  await requireUser("/settings");
  const parsed = subscriptionSchema.safeParse({
    endpoint: form.get("endpoint"),
    p256dh: form.get("p256dh"),
    auth: form.get("auth"),
  });
  if (!parsed.success) return { error: "This browser did not provide a valid push subscription." };
  const client = await createClient();
  const result = await client.rpc("save_push_subscription", {
    endpoint: parsed.data.endpoint,
    key_p256dh: parsed.data.p256dh,
    key_auth: parsed.data.auth,
    agent: String(form.get("agent") ?? "").slice(0, 120),
  });
  if (result.error) return { error: databaseError(result.error.message).message };
  revalidatePath("/settings");
  return { message: "Push is enabled on this device." };
}

export async function revokePushSubscription(form: FormData) {
  await requireUser("/settings");
  const id = uuidSchema.safeParse(form.get("subscriptionId"));
  if (!id.success) return;
  const client = await createClient();
  await client.rpc("revoke_push_subscription", { target: id.data });
  revalidatePath("/settings");
}
