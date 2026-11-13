import { prisma } from "@/lib/prisma";
import { isBlockedEitherWay } from "@/lib/blocks";
import {
  expandProductItems,
  giftSendRefusal,
  giftsHref,
  liveEffectFor,
  nextEditionNumber,
  type GiftsFromValue,
} from "@/lib/gifts";
import { createNonE2eeMessage } from "@/lib/non-e2ee-message";
import { afterMessageSent } from "@/lib/after-message-sent";
import { getHiddenPeerIds, getMembersHidingConversation } from "@/lib/hidden-chats";
import { HIDDEN_PUSH_TYPE } from "@/lib/hidden-chats-rules";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { activityLine, hiddenPush, nameOrSomeone } from "@/lib/push-text";
import { notifyBadgeChange, publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import type { Locale } from "@/lib/i18n/locales";

// The server half of digital gifts (src/lib/gifts.ts). deliverGiftPurchase is the ONE way a purchase turns into owned
// gifts. Phase 1 calls it straight after createGiftIntent (the free admin path); the payment phases will call the same
// function once a provider has confirmed payment, so nothing here knows or cares how a purchase was paid. In a lib
// file, not a "use server" one: it trusts its argument.

export type GiftDeliveryOutcome = "delivered" | "already_done" | "undeliverable" | "not_found";

const partySelect = {
  id: true,
  name: true,
  status: true,
  isAdmin: true,
  isGuestPreview: true,
  birthDate: true,
  giftsFrom: true,
} as const;

/** Whether two people are accepted connections (either direction). */
async function areConnected(aId: string, bId: string): Promise<boolean> {
  const row = await prisma.connection.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: aId, targetId: bId },
        { requesterId: bId, targetId: aId },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Delivers a PENDING purchase, once. The rules (blocks either way, the recipient's giftsFrom, age, the recipient's
 * gate) are read again first. Then, in one transaction: a guarded PENDING -> PAID claim on the purchase; only the call
 * that changed that one row goes on, so calling this twice (a retried webhook, a double tap) delivers once. If the
 * rules now say no, the send becomes UNDELIVERABLE and nothing is given (the payment phases refund those); otherwise it
 * becomes DELIVERED and the recipient gets one OwnedGift per item (a box: each contained item x its quantity).
 *
 * After the transaction, best-effort and never failing the delivery: the recipient's bell row and push, the chat card
 * for a gift sent from a chat, and the live-room signal for one sent in a live stream.
 */
export async function deliverGiftPurchase(purchaseId: string, now = new Date()): Promise<GiftDeliveryOutcome> {
  const purchase = await prisma.giftPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      product: {
        select: {
          items: {
            select: {
              itemId: true,
              quantity: true,
              item: { select: { kind: true, assetKey: true, rarity: true, editionSize: true } },
            },
          },
        },
      },
      send: {
        select: {
          id: true,
          status: true,
          context: true,
          conversationId: true,
          liveStreamId: true,
          sender: { select: partySelect },
          recipient: { select: partySelect },
        },
      },
    },
  });
  if (!purchase?.send) return "not_found";
  if (purchase.status !== "PENDING") return "already_done";
  const { send } = purchase;

  let refused = true;
  if (send.sender && send.recipient) {
    const [blocked, connected] = await Promise.all([
      isBlockedEitherWay(send.sender.id, send.recipient.id),
      areConnected(send.sender.id, send.recipient.id),
    ]);
    refused =
      giftSendRefusal({
        sender: send.sender,
        recipient: { ...send.recipient, giftsFrom: send.recipient.giftsFrom as GiftsFromValue },
        connected,
        blocked,
        context: send.context,
        now,
        atDelivery: true,
      }) !== null;
  }

  const itemIds = expandProductItems(purchase.product.items);
  const editionItems = new Map(
    purchase.product.items
      .filter((row) => row.item.rarity === "EDITION")
      .map((row) => [row.itemId, row.item.editionSize ?? null] as const),
  );
  const outcome = await prisma.$transaction(async (tx): Promise<GiftDeliveryOutcome> => {
    const claimed = await tx.giftPurchase.updateMany({
      where: { id: purchase.id, status: "PENDING" },
      data: { status: "PAID", paidAt: now },
    });
    if (claimed.count !== 1) return "already_done";
    if (refused) {
      await tx.giftSend.updateMany({
        where: { id: send.id, status: "AWAITING_PAYMENT" },
        data: { status: "UNDELIVERABLE" },
      });
      return "undeliverable";
    }
    // Numbered editions: each EDITION copy takes the next number of its item, in delivery order, under a per-item
    // advisory lock held to the end of this transaction, so two deliveries can never take the same number (the unique
    // (itemId, editionNumber) key backs it up). A limited edition that has given every copy makes the gift
    // undeliverable, like any other refusal at delivery.
    const numbers = new Map<string, number[]>();
    for (const [itemId, editionSize] of editionItems) {
      const copies = itemIds.filter((id) => id === itemId).length;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${giftEditionLockKey(itemId)}))`;
      const max = await tx.ownedGift.aggregate({ where: { itemId }, _max: { editionNumber: true } });
      let current = max._max.editionNumber ?? null;
      const taken: number[] = [];
      for (let i = 0; i < copies; i++) {
        const next = nextEditionNumber(current, editionSize);
        if (next === null) {
          await tx.giftSend.updateMany({
            where: { id: send.id, status: "AWAITING_PAYMENT" },
            data: { status: "UNDELIVERABLE" },
          });
          return "undeliverable";
        }
        taken.push(next);
        current = next;
      }
      numbers.set(itemId, taken);
    }
    await tx.giftSend.update({ where: { id: send.id }, data: { status: "DELIVERED", deliveredAt: now } });
    await tx.ownedGift.createMany({
      data: itemIds.map((itemId) => ({
        ownerId: send.recipient.id,
        itemId,
        sendId: send.id,
        ...editionField(numbers.get(itemId)?.shift()),
      })),
    });
    return "delivered";
  });

  if (outcome === "delivered" && send.sender) {
    await afterGiftDelivered({
      sendId: send.id,
      sender: send.sender,
      recipientId: send.recipient.id,
      context: send.context,
      conversationId: send.conversationId,
      liveStreamId: send.liveStreamId,
      effect: liveEffectFor(purchase.product.items.map((row) => row.item)),
    });
  }
  return outcome;
}

/** An owned copy's edition number, only for a numbered (EDITION) copy. */
function editionField(number: number | undefined): { editionNumber?: number } {
  return number === undefined ? {} : { editionNumber: number };
}

/** The advisory-lock key that serializes one EDITION item's numbering. */
export function giftEditionLockKey(itemId: string): string {
  return `gift-edition:${itemId}`;
}

async function bestEffort(step: string, sendId: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    console.error(`[gifts] ${step} failed after the gift was delivered`, err);
    await captureError(err, { where: "afterGiftDelivered", step, sendId });
  }
}

async function afterGiftDelivered(input: {
  sendId: string;
  sender: { id: string; name: string | null };
  recipientId: string;
  context: "DIRECT" | "CHAT" | "LIVE";
  conversationId: string | null;
  liveStreamId: string | null;
  effect: string;
}) {
  const { sendId, sender, recipientId, context, conversationId, liveStreamId } = input;

  // The gift card in the chat it was sent from. A chat that turned secret since can't take a message the server wrote
  // (createNonE2eeMessage refuses it): the gift is still in the recipient's Gifts area, just without a card in the chat.
  if (context === "CHAT" && conversationId) {
    await bestEffort("chat card", sendId, async () => {
      const created = await createNonE2eeMessage({
        conversationId,
        senderId: sender.id,
        content: "",
        mediaType: "NONE",
        moderationStatus: "PUBLISHED",
        giftSendId: sendId,
      });
      if (created.error) return;
      // quiet: the GIFT_RECEIVED notification below is the one notice; this only refreshes the thread and the inbox.
      await afterMessageSent({
        user: sender,
        conversationId,
        memberIds: [sender.id, recipientId],
        secret: false,
        content: "",
        mediaType: "NONE",
        quiet: true,
      });
    });
  }

  // The live room plays the effect for everyone watching. The signal names no one; the room asks getLiveGiftEffects.
  if (context === "LIVE" && liveStreamId) {
    await bestEffort("live signal", sendId, () =>
      publishEvent(REALTIME_CHANNELS.liveStream(liveStreamId), "changed", { kind: "gift" }),
    );
  }

  await bestEffort("notification", sendId, () => notifyGiftRecipient({ sender, recipientId, conversationId }));
}

/**
 * The recipient's bell row and push. A recipient who has hidden their chat with the sender (or the chat it came from)
 * gets what any message in a hidden chat gets: the neutral push and no named row.
 */
async function notifyGiftRecipient(input: {
  sender: { id: string; name: string | null };
  recipientId: string;
  conversationId: string | null;
}) {
  const { sender, recipientId, conversationId } = input;
  const hiddenPeers = await getHiddenPeerIds(recipientId);
  const hiddenChat = conversationId
    ? (await getMembersHidingConversation(conversationId, [recipientId])).length > 0
    : false;
  if (hiddenPeers.includes(sender.id) || hiddenChat) {
    await sendPushToUser(recipientId, hiddenPush);
    await sendFcmActivityToUser(recipientId, (locale) => ({ ...hiddenPush(locale), type: HIDDEN_PUSH_TYPE }));
    return;
  }
  await prisma.notification.create({
    data: { recipientId, actorId: sender.id, type: "GIFT_RECEIVED", conversationId },
    select: { id: true },
  });
  const url = giftsHref(recipientId);
  const payload = (locale: Locale) => ({
    title: nameOrSomeone(sender.name, locale),
    body: activityLine("GIFT_RECEIVED", locale),
    url,
  });
  await sendPushToUser(recipientId, payload);
  await sendFcmActivityToUser(recipientId, (locale) => ({ ...payload(locale), type: "GIFT_RECEIVED" }));
  await notifyBadgeChange(recipientId);
}
