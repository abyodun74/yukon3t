import type { TransactionClient } from "@/lib/prisma";

// Revoking a delivered gift (src/lib/gifts.ts). Its own small module, so the moderation code that calls it
// (removeModeratedContent) doesn't pull in the delivery side's push and realtime senders.

/**
 * Takes a delivered gift back (moderation: a reported gift removed, see removeModeratedContent): the send is REVOKED,
 * every item it gave is revoked, and an equipped frame or badge that no longer has an unrevoked copy is taken off.
 * Returns the sender (null once their account is gone) and the recipient, or null when there is no such gift.
 */
export async function revokeGiftSend(
  tx: TransactionClient,
  sendId: string,
  now = new Date(),
): Promise<{ senderId: string | null; recipientId: string } | null> {
  const send = await tx.giftSend.findUnique({
    where: { id: sendId },
    select: { id: true, senderId: true, recipientId: true },
  });
  if (!send) return null;
  await tx.giftSend.update({ where: { id: send.id }, data: { status: "REVOKED", revokedAt: now } });
  await tx.ownedGift.updateMany({ where: { sendId: send.id, revokedAt: null }, data: { revokedAt: now } });
  // The chat card says nothing once its gift is gone: the message stays (it is the chat's history), the card shows it
  // was removed (getGiftChatCard answers unavailable).
  const owner = await tx.user.findUnique({
    where: { id: send.recipientId },
    select: { equippedFrameItemId: true, equippedBadgeItemId: true },
  });
  if (owner) {
    const stillOwned = async (itemId: string | null) =>
      itemId !== null &&
      (await tx.ownedGift.count({ where: { ownerId: send.recipientId, itemId, revokedAt: null } })) > 0;
    const data: { equippedFrameItemId?: null; equippedBadgeItemId?: null } = {};
    if (owner.equippedFrameItemId && !(await stillOwned(owner.equippedFrameItemId))) data.equippedFrameItemId = null;
    if (owner.equippedBadgeItemId && !(await stillOwned(owner.equippedBadgeItemId))) data.equippedBadgeItemId = null;
    if (Object.keys(data).length > 0) await tx.user.update({ where: { id: send.recipientId }, data, select: { id: true } });
  }
  return { senderId: send.senderId, recipientId: send.recipientId };
}
