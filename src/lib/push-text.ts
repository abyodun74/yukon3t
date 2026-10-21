import type { NotificationType } from "@/generated/prisma/client";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import type { pushEn } from "@/lib/i18n/en/push";
import { DEFAULT_LOCALE, format, intlLocale, isLocale, type Locale } from "@/lib/i18n/locales";
import { HIDDEN_CALLER_NAME, hiddenPushPayload } from "@/lib/hidden-chats-rules";
import { pushPreview } from "@/lib/e2ee/secret-chat";
import { noticeText, type Notice } from "@/lib/notification-notice";

// Text written for someone who isn't looking at the app (web push, FCM, VoIP), in the language stored on their account
// (User.locale, kept current by src/lib/user-locale.ts). Server-only: it holds every language. The senders in push.ts,
// fcm.ts and apns-voip.ts take either a payload or a function of the recipient's language, and read that language in
// the same query that finds the recipient's devices, so wording a notification costs no extra query.

/** A payload, or how to word it for a recipient in a given language. */
export type Localized<T> = T | ((locale: Locale) => T);

/** A stored User.locale as a language to write in: anything unknown (null, a removed language) is English. */
export function storedLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Words `payload` at most once per language, however many devices or recipients share it (a group message's fan-out,
 * someone with five devices).
 */
export function perLocale<T>(payload: Localized<T>): (locale: Locale) => T {
  if (typeof payload !== "function") return () => payload;
  const build = payload as (locale: Locale) => T;
  const cache = new Map<Locale, T>();
  return (locale) => {
    if (!cache.has(locale)) cache.set(locale, build(locale));
    return cache.get(locale)!;
  };
}

/** Items grouped by their owner's stored language, in first-seen order: one send per language in a fan-out. */
export function groupByLocale<T>(items: T[], localeOf: (item: T) => string | null | undefined): Map<Locale, T[]> {
  const groups = new Map<Locale, T[]>();
  for (const item of items) {
    const locale = storedLocale(localeOf(item));
    const group = groups.get(locale);
    if (group) group.push(item);
    else groups.set(locale, [item]);
  }
  return groups;
}

export function pushText(locale: Locale): typeof pushEn {
  return dictionaryFor(locale).push;
}

/** Everything a recipient hiding a chat gets for something in it: the same neutral payload in their language. */
export function hiddenPush(locale: Locale) {
  return hiddenPushPayload(pushText(locale).hiddenBody);
}

/** A person's name, or "Someone" in the recipient's language when they have none. */
export function nameOrSomeone(name: string | null | undefined, locale: Locale): string {
  return name ?? pushText(locale).someone;
}

/**
 * The caller's name as a ring shows it: maskHiddenCallerName's stand-in (HIDDEN_CALLER_NAME) becomes "Private call" in
 * the recipient's language, a missing name "Someone". Only for what is sent to a device: getIncomingCall keeps
 * returning HIDDEN_CALLER_NAME itself, which the app's own screens recognise and word (src/lib/call-names.ts).
 */
export function ringCallerName(maskedName: string | null, locale: Locale): string {
  if (maskedName === HIDDEN_CALLER_NAME) return pushText(locale).privateCall;
  return nameOrSomeone(maskedName, locale);
}

/** The web push for an incoming call. `maskedName` is what maskHiddenCallerName returned. */
export function incomingCallPush(type: "AUDIO" | "VIDEO", maskedName: string | null): Localized<PushPayload> {
  return (locale) => {
    const t = pushText(locale).call;
    return {
      title: type === "VIDEO" ? t.incomingVideo : t.incomingVoice,
      body:
        maskedName === HIDDEN_CALLER_NAME
          ? t.callingPrivate
          : format(t.calling, { name: nameOrSomeone(maskedName, locale) }),
      url: "/",
    };
  };
}

type PushPayload = { title: string; body: string; url?: string };
type MediaType = "NONE" | "AUDIO" | "VIDEO" | "IMAGE" | "GIF";

/** A new message's push, for a recipient who doesn't hide the chat. Never the text of a secret chat (pushPreview). */
export function messagePush(params: {
  senderName: string | null;
  secret: boolean;
  content: string;
  mediaType: MediaType;
  url: string;
}): (locale: Locale) => PushPayload {
  return (locale) => {
    const t = pushText(locale).message;
    return {
      title: params.senderName ?? t.title,
      body: pushPreview(
        { secret: params.secret, content: params.content, mediaType: params.mediaType },
        { photo: t.photo, video: t.video, gif: t.gif, voice: t.voice, unreadable: t.unreadable },
      ).slice(0, 120),
      url: params.url,
    };
  };
}

/** The notification types that are pushed as "{name}" over a line saying what they did (pushActivityNotification). */
export type ActivityPushType = keyof typeof pushEn.activity & NotificationType;

export function activityLine(type: ActivityPushType, locale: Locale): string {
  return pushText(locale).activity[type];
}

/** A system notice's sentence (notification-notice.ts) in the recipient's language. */
export function noticeLine(notice: Notice, locale: Locale): string {
  const dictionary = dictionaryFor(locale);
  return noticeText(notice, dictionary.pages.notifications.notices, dictionary.ui.listSeparator);
}

/** The owner's "Notify users on older builds" push from /admin/system (actions/app-version.ts). Opens Home. */
export function appUpdatePush(locale: Locale) {
  const t = pushText(locale).appUpdate;
  return { title: t.title, body: t.body, type: "APP_UPDATE", url: "/home" };
}

/**
 * The push for a cancelled or moved Circle event (actions/circle-events.ts), under the organizer's name: what happened,
 * then for a move the new start (in UTC: the server doesn't know the recipient's time zone; the post shows local
 * time), then the reason when one was given.
 */
export function eventChangePushBody(
  type: "EVENT_CANCELLED" | "EVENT_RESCHEDULED",
  locale: Locale,
  details: { newAt?: Date | null; reason?: string | null },
): string {
  const t = pushText(locale);
  const lines = [t.activity[type]];
  if (details.newAt) {
    const when = new Intl.DateTimeFormat(intlLocale(locale) ?? "en", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(details.newAt);
    lines.push(format(t.eventChange.newTime, { when }));
  }
  if (details.reason) lines.push(format(t.eventChange.reason, { reason: details.reason.slice(0, 140) }));
  return lines.join("\n");
}
