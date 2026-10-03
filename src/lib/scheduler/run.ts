import "server-only";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { deliverPending } from "@/lib/push/delivery";

/** One cron tick. Keep the batch small for the Workers Free CPU limit. */
export async function runScheduledJobs() {
  if (!adminConfigured()) return { ok: false as const, reason: "unconfigured" };
  const admin = createAdminClient();
  const finalized = await admin.rpc("finalize_due_votes", { batch: 10 });
  const reminders = await admin.rpc("enqueue_trade_reminders");
  const delivery = await deliverPending(5);
  return {
    ok: true as const,
    finalized: finalized.error ? 0 : Number(finalized.data ?? 0),
    reminders: reminders.error ? 0 : Number(reminders.data ?? 0),
    delivery,
  };
}
