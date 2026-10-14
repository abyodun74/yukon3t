import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recordActivity } from "@/lib/trust";
import { sendPushToUsers } from "@/lib/push";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { captureError } from "@/lib/error-tracking";
import { track } from "@/lib/analytics";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { getMembersHidingConversation } from "@/lib/hidden-chats";
import { HIDDEN_PUSH_TYPE, splitHiddenRecipients } from "@/lib/hidden-chats-rules";
import { hiddenPush, messagePush } from "@/lib/push-text";

/**
 * Everything that follows a message being stored: activity/analytics, push (web + native), the in-app notification
 * rows, badge counts and the realtime nudge. Shared by sendMessage, shareMuseToConversation and sendViewOnceMessage so a
 * message sent any of those ways reaches the recipient identically. In a lib file, not actions/messages.ts: every export
 * of a "use server" file is callable from the browser, and this trusts its `user` argument.
 */
export async function afterMessageSent({
  user,
  conversationId,
  memberIds,
  secret,
  content,
  mediaType,
}: {
  user: { id: string; name: string | null };
  conversationId: string;
  memberIds: string[];
  secret: boolean;
  content: string;
  mediaType: "NONE" | "AUDIO" | "VIDEO" | "IMAGE" | "GIF";
}) {
  // The message row is already committed by the time this runs, so nothing
  // below may throw out of the action — the sender would see an error and
  // resend a duplicate. Each step fails on its own, so one of them breaking
  // (e.g. a pool timeout) doesn't also cost the recipient the steps after it.
  async function bestEffort(step: string, run: () => Promise<unknown>) {
    try {
      await run();
    } catch (err) {
      console.error(`[messages] ${step} failed after message was stored`, err);
      await captureError(err, { step, conversationId });
    }
  }

  await bestEffort("recordActivity", () => recordActivity(user.id));
  await track("MESSAGE_SENT", user.id, { conversationId, mediaType });

  const recipientIds =
    memberIds.filter((id) => id !== user.id);
  // A recipient who has this chat hidden gets none of what identifies it: no sender name, no preview, no link into the
  // thread and no bell row, only a generic notification that opens Home. If the lookup itself fails, everyone gets
  // that generic push: a vague notification for all is the safe mistake, a named one on the wrong phone is not.
  let hidingIds: string[] = recipientIds;
  let hiddenLookupFailed = false;
  try {
    hidingIds = await getMembersHidingConversation(conversationId, recipientIds);
  } catch (err) {
    hiddenLookupFailed = true;
    console.error("[messages] hidden-chat lookup failed after message was stored", err);
    await captureError(err, { step: "hiddenRecipients", conversationId });
  }
  const { open: openIds, hidden: hiddenIds } = splitHiddenRecipients(recipientIds, hidingIds);
  // Never the message text in a secret chat, and never ciphertext anywhere (pushPreview, through messagePush). Each
  // recipient's copy is in their own language, read with their devices in the same query; worded once per language.
  const messagePayload = messagePush({
    senderName: user.name,
    secret,
    content,
    mediaType,
    url: `/messages/${conversationId}`,
  });
  // One query + bounded sends for every recipient together (not a query and
  // an unbounded Promise.all per recipient) — a group has no member cap, and
  // the Prisma pool is only a handful of connections (src/lib/prisma.ts).
  await bestEffort("webPush", () => sendPushToUsers(openIds, messagePayload));
  await bestEffort("webPushHidden", () => sendPushToUsers(hiddenIds, hiddenPush));
  // Web Push (above) never reaches a Capacitor-wrapped mobile app — iOS's
  // WebView doesn't support the Push API at all, and Android's own native
  // notification path for messages was this same gap (only comments/likes/
  // connections/muse activity went through sendFcmActivityToUser; sending a
  // message had no FCM path whatsoever). Confirmed live: a real message
  // showed the in-app bell/badge update instantly (Realtime, unaffected)
  // but never surfaced as a native push on iOS.
  await bestEffort("fcm", () =>
    sendFcmActivityToUsers(openIds, (locale) => ({ ...messagePayload(locale), type: "MESSAGE" })),
  );
  // The FCM data block is only { type, url }: no conversation id or sender in it for these recipients either.
  await bestEffort("fcmHidden", () =>
    sendFcmActivityToUsers(hiddenIds, (locale) => ({ ...hiddenPush(locale), type: HIDDEN_PUSH_TYPE })),
  );
  // In-app only (no email) — see MESSAGE in the NotificationType enum. One
  // row per recipient per message, same as every other notification type
  // here (no dedup/throttling), so it shows up in the bell alongside likes,
  // comments, etc. instead of only in the Messages tab's own unread badge.
  // When the hidden lookup failed nobody is known to be "open", but the rows are still written for everyone: a row
  // is only ever shown through visibleNotificationWhere (the bell count and /notifications), which drops any row
  // whose conversation the reader has hidden, so writing one for a hiding recipient shows them nothing.
  const bellIds = hiddenLookupFailed ? recipientIds : openIds;
  if (bellIds.length > 0) {
    await bestEffort("notifications", () =>
      prisma.notification.createMany({
        data: bellIds.map((recipientId) => ({
          recipientId,
          actorId: user.id,
          type: "MESSAGE" as const,
          conversationId,
        })),
      }),
    );
  }
  // Every recipient's badge nudge plus the thread's own "changed" signal in
  // one batched request, rather than one HTTP call per recipient.
  await bestEffort("realtime", () =>
    publishEvents([
      ...recipientIds.map((recipientId) => ({
        channel: REALTIME_CHANNELS.navBadges(recipientId),
        event: "changed",
      })),
      { channel: REALTIME_CHANNELS.conversation(conversationId), event: "changed" },
    ]),
  );

  revalidatePath(`/messages/${conversationId}`);
}
