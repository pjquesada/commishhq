import "server-only";
import { z } from "zod";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { buildWebPushBody, vapidJwt } from "./crypto";
import { leagueLog } from "@/lib/leagues/log";
import { shouldDropSubscription } from "./link";

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
}
export interface NotificationResult {
  delivered: boolean;
  dropped: string[];
}
export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}
export interface NotificationProvider {
  send(
    userId: string,
    notification: NotificationPayload,
    subscriptions: PushTarget[],
  ): Promise<NotificationResult>;
}

export class WebPushProvider implements NotificationProvider {
  async send(
    _userId: string,
    notification: NotificationPayload,
    subscriptions: PushTarget[],
  ): Promise<NotificationResult> {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
    const subject = process.env.VAPID_SUBJECT ?? "";
    const dropped: string[] = [];
    let delivered = false;
    for (const subscription of subscriptions) {
      const endpoint = new URL(subscription.endpoint);
      const token = await vapidJwt({
        audience: endpoint.origin,
        subject,
        publicKey,
        privateKey,
        expiresAt: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      });
      const encrypted = await buildWebPushBody({
        plaintext: JSON.stringify(notification),
        p256dh: subscription.p256dh,
        auth: subscription.auth_secret,
      });
      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${token}, k=${publicKey}`,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
        },
        body: new Blob([new Uint8Array(encrypted)]),
      });
      if (response.ok) delivered = true;
      else if (shouldDropSubscription(response.status)) dropped.push(subscription.id);
    }
    return { delivered, dropped };
  }
}

const claimSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  league_id: z.uuid().nullable(),
  payload: z.object({
    title: z.string(),
    body: z.string(),
    url: z.string(),
  }),
  subscriptions: z.array(
    z.object({
      id: z.uuid(),
      endpoint: z.string().url(),
      p256dh: z.string(),
      auth_secret: z.string(),
    }),
  ),
});

export async function deliverPending(limit = 5): Promise<{ sent: number; skipped: number }> {
  if (!adminConfigured()) return { sent: 0, skipped: 0 };
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return { sent: 0, skipped: 0 };
  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_notifications", { batch: limit });
  if (claimed.error || !Array.isArray(claimed.data)) return { sent: 0, skipped: 0 };
  let sent = 0;
  let skipped = 0;
  for (const row of claimed.data) {
    const parsed = claimSchema.safeParse(row);
    if (!parsed.success) continue;
    if (parsed.data.subscriptions.length === 0) {
      await admin.rpc("complete_notification", {
        target: parsed.data.id,
        outcome: "skipped",
        drop_ids: [],
      });
      skipped += 1;
      continue;
    }
    const result = await new WebPushProvider().send(
      parsed.data.user_id,
      parsed.data.payload,
      parsed.data.subscriptions,
    );
    await admin.rpc("complete_notification", {
      target: parsed.data.id,
      outcome: result.delivered ? "sent" : "failed",
      drop_ids: result.dropped,
    });
    if (parsed.data.league_id)
      leagueLog(
        result.delivered ? "notification_sent" : "notification_failed",
        parsed.data.league_id,
      );
    if (result.delivered) sent += 1;
  }
  return { sent, skipped };
}
