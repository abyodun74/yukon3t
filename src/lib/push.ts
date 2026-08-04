import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

export const isPushConfigured = !!vapidPublicKey && !!vapidPrivateKey;

if (isPushConfigured) {
  // The VAPID "subject" is just a contact identifier for push services to
  // reach out to if this key pair is misbehaving — it must be exactly
  // "https:" or "mailto:", so it can't be NEXT_PUBLIC_APP_URL directly
  // (that's "http://localhost:3000" in local dev, which webpush rejects).
  webpush.setVapidDetails("mailto:support@yukon3t.com", vapidPublicKey!, vapidPrivateKey!);
}

/**
 * Best-effort — a push failure should never break the call/message action
 * that triggered it. Self-generated VAPID keys (no third-party account
 * needed), so this is a no-op until the env vars above are set, same
 * pattern as isCallingConfigured() for Daily.co.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string },
) {
  if (!isPushConfigured) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        // 404/410 = the browser/device unsubscribed or the subscription
        // expired — stop trying to push to it. Any other error (a
        // transient outage) is left alone rather than deleting a
        // possibly-still-valid subscription.
        const statusCode = (err as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );
}
