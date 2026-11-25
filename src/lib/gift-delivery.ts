import { prisma, type TransactionClient } from "@/lib/prisma";
import { isBlockedEitherWay } from "@/lib/blocks";
import {
  expandProductItems,
  giftSendRefusal,
  giftsHref,
  liveEffectFor,
  nextEditionNumber,
  systemAwardRefusal,
  type GiftsFromValue,
} from "@/lib/gifts";
import { createNonE2eeMessage } from "@/lib/non-e2ee-message";
import { afterMessageSent } from "@/lib/after-message-sent";
import { getHiddenPeerIds, getMembersHidingConversation } from "@/lib/hidden-chats";
import { HIDDEN_PUSH_TYPE } from "@/lib/hidden-chats-rules";
import { sendPushToUser } from "@/lib/push";
import { sendFcmActivityToUser } from "@/lib/fcm";
import { hiddenPush, nameOrSomeone, noticeLine, storedLocale } from "@/lib/push-text";
import { encodeNotice } from "@/lib/notification-notice";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import { giftProductName } from "@/lib/gift-names";
import { notifyBadgeChange, publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import { refundCoinPurchaseInTx } from "@/lib/coin-wallet";
import type { Locale } from "@/lib/i18n/locales";

// The server half of digital gifts (src/lib/gifts.ts). deliverGiftPurchase is the ONE way a purchase turns into owned
// gifts. createGiftIntent calls it straight after the coins were spent (src/lib/coin-wallet.ts); free gifts and awards
// call it straight after creating their purchase. The only thing it knows about how a purchase was paid: a COINS
// purchase that turns out to be undeliverable gets its coins back in the same transaction (refundCoinPurchaseInTx).
// In a lib file, not a "use server" one: it trusts its argument.

export type GiftDeliveryOutcome = "delivered" | "already_done" | "undeliverable" | "not_found";

const partySelect = {
  id: true,
  name: true,
  status: true,
  isAdmin: true,
  isGuestPreview: true,
  birthDate: true,
  giftsFrom: true,
  locale: true,
} as const;

/** What the notification calls a gift: its catalog name, in one language. */
export type GiftNameSource = { sku: string; isBox: boolean; items: { slug: string }[] };

export function giftNameFor(product: GiftNameSource, locale: Locale): string {
  return giftProductName(dictionaryFor(locale).gifts, product);
}

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
      provider: true,
      buyerId: true,
      amountMinor: true,
      quantity: true,
      product: {
        select: {
          sku: true,
          isBox: true,
          items: {
            select: {
              itemId: true,
              quantity: true,
              item: { select: { slug: true, sortOrder: true, kind: true, assetKey: true, rarity: true, editionSize: true } },
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
  const systemAward = purchase.provider === "SYSTEM_AWARD";
  if (systemAward) {
    // Phase B: an award the app gives (a challenge winner's Champion badge) has no sender, so only the recipient's own
    // standing is checked (systemAwardRefusal explains why the person-to-person rules don't apply).
    refused = !send.recipient || send.sender !== null || systemAwardRefusal(send.recipient) !== null;
  } else if (send.sender && send.recipient) {
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

  // A purchase of several (the marketplace's quantity) gives the product's contents that many times.
  const perProduct = expandProductItems(purchase.product.items);
  const quantity = Math.min(10, Math.max(1, Math.floor(purchase.quantity ?? 1)));
  const itemIds = Array.from({ length: quantity }, () => perProduct).flat();
  // An undeliverable coin-paid gift gets its coins back in the same transaction as the refusal.
  const coinPaid = purchase.provider === "COINS";
  const refuse = async (tx: TransactionClient) => {
    await tx.giftSend.updateMany({
      where: { id: send.id, status: "AWAITING_PAYMENT" },
      data: { status: "UNDELIVERABLE" },
    });
    if (coinPaid) {
      await refundCoinPurchaseInTx(tx, { id: purchase.id, buyerId: purchase.buyerId ?? null, amountMinor: purchase.amountMinor ?? 0 }, now);
    }
  };
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
      await refuse(tx);
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
          await refuse(tx);
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

  // An award notifies nobody here: the challenge's own CHALLENGE_RESULT notice is the winner's one notice.
  if (outcome === "delivered" && send.sender && !systemAward) {
    await afterGiftDelivered({
      sendId: send.id,
      sender: send.sender,
      recipientId: send.recipient.id,
      recipientLocale: storedLocale(send.recipient.locale),
      gift: {
        sku: purchase.product.sku,
        isBox: purchase.product.isBox,
        items: [...purchase.product.items].sort((a, b) => a.item.sortOrder - b.item.sortOrder).map((row) => ({ slug: row.item.slug })),
      },
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
  recipientLocale: Locale;
  gift: GiftNameSource;
  context: "DIRECT" | "CHAT" | "LIVE";
  conversationId: string | null;
  liveStreamId: string | null;
  effect: string;
}) {
  const { sendId, sender, recipientId, recipientLocale, gift, context, conversationId, liveStreamId } = input;

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

  await bestEffort("notification", sendId, () =>
    notifyGiftRecipient({ sender, recipientId, recipientLocale, gift, conversationId }),
  );
}

/**
 * The recipient's bell row and push: who sent it and the gift's name ("Ada sent you a gift: Diamond Heart"), the name
 * stored in the recipient's language for the bell row and worded per language for the push. A recipient who has hidden
 * their chat with the sender (or the chat it came from) gets what any message in a hidden chat gets: the neutral push
 * and no named row (no gift name either).
 */
async function notifyGiftRecipient(input: {
  sender: { id: string; name: string | null };
  recipientId: string;
  recipientLocale: Locale;
  gift: GiftNameSource;
  conversationId: string | null;
}) {
  const { sender, recipientId, recipientLocale, gift, conversationId } = input;
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
    data: {
      recipientId,
      actorId: sender.id,
      type: "GIFT_RECEIVED",
      conversationId,
      messageData: encodeNotice({ kind: "gift_received", gift: giftNameFor(gift, recipientLocale) }),
    },
    select: { id: true },
  });
  const url = giftsHref(recipientId);
  const payload = (locale: Locale) => ({
    title: nameOrSomeone(sender.name, locale),
    body: noticeLine({ kind: "gift_received", gift: giftNameFor(gift, locale) }, locale),
    url,
  });
  await sendPushToUser(recipientId, payload);
  await sendFcmActivityToUser(recipientId, (locale) => ({ ...payload(locale), type: "GIFT_RECEIVED" }));
  await notifyBadgeChange(recipientId);
}
