import webpush from "web-push";
import { prisma } from "@/lib/prisma";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

const isPushConfigured = !!vapidPublicKey && !!vapidPrivateKey;

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
// Bounds how many web-push sends run concurrently — an unbounded
// Promise.all across every subscription in the app (unlike every other
// caller here, which only ever pushes to one user's handful of devices)
// risks a burst large enough to trip rate limits on the push services
// themselves, or spike this serverless function's own resource use.
const BROADCAST_BATCH_SIZE = 50;

/**
 * Pushes a real notification to every browser subscribed across every
 * user — used only by createAnnouncement (actions/announcements.ts) for a
 * genuine "announce to all users" broadcast, the web-push counterpart to
 * fcm.ts's broadcastFcmAnnouncement. Batched rather than one unbounded
 * Promise.all, for the same reason. Best-effort — a push failure must
 * never block the announcement itself from being created/visible via the
 * in-app WhatsNewBell.
 */
export async function broadcastPushAnnouncement(payload: { title: string; body: string; url?: string }) {
  if (!isPushConfigured) return;

  const subscriptions = await prisma.pushSubscription.findMany();
  for (let i = 0; i < subscriptions.length; i += BROADCAST_BATCH_SIZE) {
    const batch = subscriptions.slice(i, i + BROADCAST_BATCH_SIZE);
    await Promise.all(
      batch.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number } | null)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
        }
      }),
    );
  }
}

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
