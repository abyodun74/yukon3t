import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { createNonE2eeMessage } from "@/lib/non-e2ee-message";
import { afterMessageSent } from "@/lib/after-message-sent";
import { findDirectConversationId, startDirectConversation } from "@/lib/direct-conversation";
import { getHiddenPeerIds, getMembersHidingConversation, isMembershipLocked } from "@/lib/hidden-chats";
import { HIDDEN_PUSH_TYPE } from "@/lib/hidden-chats-rules";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { activityLine, hiddenPush, nameOrSomeone } from "@/lib/push-text";
import { notifyBadgeChange } from "@/lib/realtime-server";
import { encodeNotice } from "@/lib/notification-notice";
import { captureError } from "@/lib/error-tracking";
import type { Locale } from "@/lib/i18n/locales";
import { birthdayWishContext } from "@/lib/birthdays-data";
import { birthdayWishContent, type BirthdayPresetId, type BirthdayWishChoice } from "@/lib/birthdays";

// Sending a birthday wish (sendBirthdayWish in actions/birthdays.ts). The wish is an ordinary direct message from the
// sender to the celebrant, written through the same machinery as any other server-built message: blocks and audience
// re-checked (birthdayWishContext), the "message request" a first message to a non-connection is
// (startDirectConversation), the hidden-chat lock, the messageSend limit, moderation of custom text, and
// createNonE2eeMessage, which refuses a secret chat. What differs is the notification: the celebrant gets no push per
// wish, only one combined BIRTHDAY_WISHES row per year (BirthdayWishDigest), pushed on the first wish.
// In a lib file, not the "use server" one: it trusts its `user` argument.

export type BirthdayWishResult =
  | { error: null; conversationId: string }
  | { error: "invalid" | "rate_limited" | "unavailable" | "already_wished" | "moderation" | "hidden_locked" };

export async function sendBirthdayWishAs(
  user: { id: string; name: string | null },
  input: BirthdayWishChoice & { celebrantId: string },
  presets: Record<BirthdayPresetId, string>,
  now = new Date(),
): Promise<BirthdayWishResult> {
  const { celebrantId } = input;
  if (celebrantId === user.id) return { error: "invalid" };
  if (!(await checkRateLimit("birthdayWish", user.id))) return { error: "rate_limited" };
  if (!(await checkRateLimit("messageSend", user.id))) return { error: "rate_limited" };

  // Every refusal (not sharing any more, not in the audience, blocked either way, no reminder) is the same answer, so
  // a wish can't be used to find out which one it was.
  const context = await birthdayWishContext(user.id, celebrantId, now);
  if (!context) return { error: "unavailable" };
  const { year } = context;
  const already = await prisma.birthdayWish.findUnique({
    where: { senderId_celebrantId_year: { senderId: user.id, celebrantId, year } },
    select: { id: true },
  });
  if (already) return { error: "already_wished" };

  const content = birthdayWishContent(input, presets);
  if (!content) return { error: "invalid" };
  // Custom text is checked like any other message text; flagged text is refused rather than sent hidden, so the sender
  // can reword it (the emoji and ready-made messages are ours).
  if (input.kind === "custom" && !(await moderateText(content)).allowed) return { error: "moderation" };

  let conversationId = await findDirectConversationId(user.id, celebrantId);
  if (conversationId) {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      select: { hiddenAt: true },
    });
    if (!membership) return { error: "unavailable" };
    if (await isMembershipLocked(membership, user.id)) return { error: "hidden_locked" };
  } else if (!(await checkRateLimit("connectionRequest", user.id))) {
    // A first message to someone you're not connected to is a message request, limited like startDirectMessage.
    return { error: "rate_limited" };
  }

  // One wish per sender per celebrant per year: the unique key is claimed before anything is sent, so a double tap
  // or two devices at once send one message.
  let wishId: string;
  try {
    wishId = (await prisma.birthdayWish.create({ data: { senderId: user.id, celebrantId, year }, select: { id: true } })).id;
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "already_wished" };
    throw err;
  }

  let sent: Awaited<ReturnType<typeof createNonE2eeMessage>>;
  try {
    if (!conversationId) conversationId = await startDirectConversation(user.id, context.celebrant, "birthday_wish");
    const result = await createNonE2eeMessage({
      conversationId,
      senderId: user.id,
      content,
      mediaType: "NONE",
      moderationStatus: "PUBLISHED",
    });
    sent = result;
  } catch (err) {
    // Nothing was sent: release the claim so the sender can try again.
    await prisma.birthdayWish.delete({ where: { id: wishId } });
    throw err;
  }
  if (sent.error) {
    // A secret chat can't take a message the server wrote; the wish is released so nothing counts as sent.
    await prisma.birthdayWish.delete({ where: { id: wishId } });
    return { error: "unavailable" };
  }
  await prisma.birthdayWish.update({ where: { id: wishId }, data: { messageId: sent.id } });

  await afterMessageSent({
    user,
    conversationId,
    memberIds: [user.id, celebrantId],
    secret: false,
    content,
    mediaType: "NONE",
    quiet: true,
  });
  try {
    await notifyCelebrant({ wisher: user, celebrantId, year, conversationId, now });
  } catch (err) {
    // The message is stored: never fail the action (the sender would send it again).
    console.error("[birthday-wish] celebrant notice failed after the wish was sent", err);
    await captureError(err, { where: "notifyCelebrant", celebrantId });
  }
  return { error: null, conversationId };
}

/**
 * The celebrant's one combined notice. A celebrant who hides their chat with this wisher gets what any message in a
 * hidden chat gets (the neutral push, no named row) and this wish isn't counted in the combined row. Otherwise the
 * year's first wish creates the BIRTHDAY_WISHES row together with its BirthdayWishDigest (the unique key decides
 * which wish is first, even when two arrive at once) and is the only one pushed; every later wish moves that same row
 * back to the top, unread, naming the latest wisher and counting the others.
 */
async function notifyCelebrant(input: {
  wisher: { id: string; name: string | null };
  celebrantId: string;
  year: number;
  conversationId: string;
  now: Date;
}) {
  const { wisher, celebrantId, year, conversationId, now } = input;
  if ((await getMembersHidingConversation(conversationId, [celebrantId])).length > 0) {
    await sendPushToUser(celebrantId, hiddenPush);
    await sendFcmActivityToUser(celebrantId, (locale) => ({ ...hiddenPush(locale), type: HIDDEN_PUSH_TYPE }));
    return;
  }

  const row = { recipientId: celebrantId, actorId: wisher.id, type: "BIRTHDAY_WISHES" as const, conversationId };
  let first = false;
  try {
    await prisma.birthdayWishDigest.create({
      data: {
        year,
        celebrant: { connect: { id: celebrantId } },
        notification: {
          create: {
            type: "BIRTHDAY_WISHES",
            recipient: { connect: { id: celebrantId } },
            actor: { connect: { id: wisher.id } },
            conversation: { connect: { id: conversationId } },
          },
        },
      },
      select: { id: true },
    });
    first = true;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }

  if (first) {
    const url = `/messages/${conversationId}`;
    const payload = (locale: Locale) => ({
      title: nameOrSomeone(wisher.name, locale),
      body: activityLine("BIRTHDAY_WISHES", locale),
      url,
    });
    await sendPushToUser(celebrantId, payload);
    await sendFcmActivityToUser(celebrantId, (locale) => ({ ...payload(locale), type: "BIRTHDAY_WISHES" }));
  } else {
    const hiddenPeerIds = await getHiddenPeerIds(celebrantId);
    const total = await prisma.birthdayWish.count({
      where: { celebrantId, year, messageId: { not: null }, senderId: { notIn: hiddenPeerIds } },
    });
    const others = Math.max(0, total - 1);
    const messageData = others > 0 ? encodeNotice({ kind: "birthday_wishes", others }) : null;
    const digest = await prisma.birthdayWishDigest.findUnique({
      where: { celebrantId_year: { celebrantId, year } },
      select: { id: true, notificationId: true },
    });
    if (digest?.notificationId) {
      await prisma.notification.update({
        where: { id: digest.notificationId },
        data: { actorId: wisher.id, conversationId, messageData, readAt: null, createdAt: now },
      });
    } else if (digest) {
      // The row was deleted (its conversation went away): start a new one, without pushing again.
      const created = await prisma.notification.create({ data: { ...row, messageData }, select: { id: true } });
      await prisma.birthdayWishDigest.update({ where: { id: digest.id }, data: { notificationId: created.id } });
    }
  }
  await notifyBadgeChange(celebrantId);
}
