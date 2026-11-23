import { sendFcmActivityToUser, sendFcmActivityToUsers } from "@/lib/fcm";
import { sendPushToUser, sendPushToUsers } from "@/lib/push";
import { activityLine, nameOrSomeone, type ActivityPushType } from "@/lib/push-text";
import type { Locale } from "@/lib/i18n/locales";

function activityPayload(type: ActivityPushType, actorName: string | null, url: string | undefined) {
  return (locale: Locale) => ({
    title: nameOrSomeone(actorName, locale),
    body: activityLine(type, locale),
    type,
    url,
  });
}

function browserPayload(payload: ReturnType<typeof activityPayload>, url: string | undefined) {
  return (locale: Locale) => {
    const { title, body } = payload(locale);
    return { title, body, ...(url ? { url } : {}) };
  };
}

/**
 * Phone and browser companion to an in-app `Notification` row — call this right
 * alongside `prisma.notification.create` for any type that should also
 * reach the person outside the app: a real notification on their phone (FCM,
 * see sendFcmActivityToUser for why this is a "notification" payload, not
 * data-only like calls) and in every browser they turned notifications on in
 * (Web Push). Browsers used to get only calls and messages, so a like, comment
 * or connection request reached a web user only as the in-app bell.
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
  const payload = activityPayload(type, actorName, url);
  // Side by side, and each on its own: a slow or failing phone send never holds up or skips the browser one.
  await Promise.all([
    sendFcmActivityToUser(recipientId, payload).catch(() => {}),
    sendPushToUser(recipientId, browserPayload(payload, url)).catch(() => {}),
  ]);
}

/** pushActivityNotification for many recipients of the same activity: one token lookup, one send per language. */
export async function pushActivityNotificationToMany(
  recipientIds: string[],
  type: ActivityPushType,
  actorName: string | null,
  url?: string,
) {
  const payload = activityPayload(type, actorName, url);
  await Promise.all([
    sendFcmActivityToUsers(recipientIds, payload).catch(() => {}),
    sendPushToUsers(recipientIds, browserPayload(payload, url)).catch(() => {}),
  ]);
}
