import type { Prisma } from "@/generated/prisma/client";

// The pure half of hidden chats: every rule and constant, with no database, cookie store or request in sight, so it can
// be unit-tested (hidden-chats-rules.test.ts) and imported by client components. The server half that reads rows and cookies is src/lib/hidden-chats.ts.

export const HIDDEN_PIN_PATTERN = /^\d{4,8}$/;

export const HIDDEN_PIN_ATTEMPTS_PER_LOCK = 5;
export const HIDDEN_PIN_BASE_LOCK_MS = 15 * 60 * 1000;
export const HIDDEN_PIN_MAX_LOCK_MS = 24 * 60 * 60 * 1000;

/**
 * `failedAttempts` is the count of wrong PINs since the last correct one, including the attempt being made now. Every
 * 5th one locks: 15 minutes at 5, then doubling (30m at 10, 1h at 15, ...) up to a day. Null means no lock for this
 * attempt. The count is only reset by a correct PIN or a PIN reset, which is what makes the lock escalate.
 */
export function hiddenPinLockoutUntil(failedAttempts: number, now: Date): Date | null {
  if (failedAttempts <= 0 || failedAttempts % HIDDEN_PIN_ATTEMPTS_PER_LOCK !== 0) return null;
  const round = failedAttempts / HIDDEN_PIN_ATTEMPTS_PER_LOCK;
  // Capped before the multiply so a very large count can't overflow into Infinity.
  const factor = 2 ** Math.min(round - 1, 20);
  return new Date(now.getTime() + Math.min(HIDDEN_PIN_BASE_LOCK_MS * factor, HIDDEN_PIN_MAX_LOCK_MS));
}

export function isHiddenPinLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/** Wrong PINs still allowed before the next lock, given the count after the attempt just made. */
export function hiddenPinAttemptsLeft(failedAttempts: number): number {
  return HIDDEN_PIN_ATTEMPTS_PER_LOCK - (failedAttempts % HIDDEN_PIN_ATTEMPTS_PER_LOCK);
}

// ---------- Notifications ----------

/**
 * What a new message in a hidden chat sends to the person hiding it: nothing that names the chat, the sender or the text.
 * `body` is that one neutral sentence in the recipient's language (push.hiddenBody in src/lib/i18n, worded by
 * hiddenPush in src/lib/push-text.ts); the title is the app's name in every language.
 */
export function hiddenPushPayload(body = "You have a new notification") {
  return { title: "YuKon3t", body, url: "/home" };
}

/** The `type` on the native (FCM) version of that payload. Deliberately not "MESSAGE". */
export const HIDDEN_PUSH_TYPE = "GENERAL";

/** Splits a message's recipients into those who get the normal named notification and those who have the chat hidden. */
export function splitHiddenRecipients(recipientIds: string[], hidingIds: Iterable<string>) {
  const hiding = new Set(hidingIds);
  const open: string[] = [];
  const hidden: string[] = [];
  for (const id of recipientIds) (hiding.has(id) ? hidden : open).push(id);
  return { open, hidden };
}

export type HiddenState = { conversationIds: string[]; peerIds: string[] };

/**
 * Bell notification types that are about a private exchange with their actor. One of these from a hidden 1:1 peer is
 * hidden even when the row carries no conversationId (MISSED_CALL never does). Public activity by the same person (a
 * like, a comment, a new post) is not: hiding a chat doesn't hide the person's public presence.
 */
export const HIDDEN_PEER_NOTIFICATION_TYPES = ["MESSAGE", "MISSED_CALL", "SCREENSHOT_TAKEN"] as const;

export function isHiddenNotification(
  notification: { type: string; actorId: string; conversationId: string | null },
  hidden: HiddenState,
): boolean {
  if (notification.conversationId && hidden.conversationIds.includes(notification.conversationId)) return true;
  return (
    hidden.peerIds.includes(notification.actorId) &&
    (HIDDEN_PEER_NOTIFICATION_TYPES as readonly string[]).includes(notification.type)
  );
}

/**
 * The same rule as isHiddenNotification, as Prisma `where` conditions to AND into a Notification query. Written as
 * "null or not in" / "not in or not in" rather than one NOT(...): in SQL a NOT over a NULL conversationId is NULL, which
 * would drop every notification that has no conversation at all.
 */
export function visibleNotificationWhere(hidden: HiddenState): Prisma.NotificationWhereInput[] {
  const conditions: Prisma.NotificationWhereInput[] = [];
  if (hidden.conversationIds.length > 0) {
    conditions.push({ OR: [{ conversationId: null }, { conversationId: { notIn: hidden.conversationIds } }] });
  }
  if (hidden.peerIds.length > 0) {
    conditions.push({
      OR: [{ actorId: { notIn: hidden.peerIds } }, { type: { notIn: [...HIDDEN_PEER_NOTIFICATION_TYPES] } }],
    });
  }
  return conditions;
}

// ---------- Routes ----------

export const HIDDEN_CHATS_PATH = "/messages/hidden";

/** Only ever send someone back into a conversation thread after unlocking, never to an arbitrary URL. */
export function safeHiddenNext(next: string | null | undefined): string | null {
  return next && /^\/messages\/[a-z0-9]{1,64}$/i.test(next) && next !== HIDDEN_CHATS_PATH ? next : null;
}

export function hiddenUnlockPath(conversationId?: string) {
  return conversationId ? `${HIDDEN_CHATS_PATH}?next=${encodeURIComponent(`/messages/${conversationId}`)}` : HIDDEN_CHATS_PATH;
}

/** Shown in place of a hidden peer's name wherever an incoming call is announced. */
export const HIDDEN_CALLER_NAME = "Private call";
