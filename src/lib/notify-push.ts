import type { NotificationType } from "@/generated/prisma/client";
import { NOTIFICATION_VERB } from "@/lib/notification-text";
import { sendFcmActivityToUser } from "@/lib/fcm";

/**
 * Native push companion to an in-app `Notification` row — call this right
 * alongside `prisma.notification.create` for any type that should also
 * reach the phone as a real Android notification (see sendFcmActivityToUser
 * for why this is a "notification" FCM payload, not data-only like calls).
 * Reuses NOTIFICATION_VERB so push copy never drifts from the in-app bell's
 * own text. Best-effort — never throws.
 */
export async function pushActivityNotification(
  recipientId: string,
  type: NotificationType,
  actorName: string,
  url?: string,
) {
  await sendFcmActivityToUser(recipientId, {
    title: actorName,
    body: NOTIFICATION_VERB[type],
    type,
    url,
  });
}
