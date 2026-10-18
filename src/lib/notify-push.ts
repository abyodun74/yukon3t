import { sendFcmActivityToUser, sendFcmActivityToUsers } from "@/lib/fcm";
import { activityLine, nameOrSomeone, type ActivityPushType } from "@/lib/push-text";

/**
 * Native push companion to an in-app `Notification` row — call this right
 * alongside `prisma.notification.create` for any type that should also
 * reach the phone as a real Android notification (see sendFcmActivityToUser
 * for why this is a "notification" FCM payload, not data-only like calls).
 * The actor's name is the title and the line under it says what they did, in
 * the recipient's language (push.activity in src/lib/i18n, which in English is
 * NOTIFICATION_VERB, the in-app bell's own text). Best-effort — never throws.
 */
export async function pushActivityNotification(
  recipientId: string,
  type: ActivityPushType,
  actorName: string | null,
  url?: string,
) {
  await sendFcmActivityToUser(recipientId, (locale) => ({
    title: nameOrSomeone(actorName, locale),
    body: activityLine(type, locale),
    type,
    url,
  }));
}

/** pushActivityNotification for many recipients of the same activity: one token lookup, one send per language. */
export async function pushActivityNotificationToMany(
  recipientIds: string[],
  type: ActivityPushType,
  actorName: string | null,
  url?: string,
) {
  await sendFcmActivityToUsers(recipientIds, (locale) => ({
    title: nameOrSomeone(actorName, locale),
    body: activityLine(type, locale),
    type,
    url,
  }));
}
