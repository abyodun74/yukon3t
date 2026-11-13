"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isMembershipLocked } from "@/lib/hidden-chats";
import { isSecretChat } from "@/lib/e2ee/secret-chat";
import { canAccessLiveStream } from "@/lib/live-stream-access";
import { holdsViewerSlot } from "@/lib/live-viewer-cap";
import { deliverGiftPurchase } from "@/lib/gift-delivery";
import {
  LIVE_GIFT_EFFECT_WINDOW_MS,
  canEquip,
  giftMessageRefusal,
  giftSendRefusal,
  giftsEnabledFor,
  liveEffectFor,
  normalizeGiftMessage,
  type GiftsFromValue,
} from "@/lib/gifts";
import {
  giftEquipKindSchema,
  giftIntentSchema,
  giftItemSlugSchema,
  giftSendIdSchema,
  giftsFromSchema,
} from "@/lib/validations";

// Digital gifts (rules: src/lib/gifts.ts; delivery: src/lib/gift-delivery.ts). Every action re-derives the user from
// the session and refuses unless giftsEnabledFor says gifts are on for them (Phase 1: site admins only), whatever the
// UI shows. Answers carry only what the screen needs: never a User row, and the sender of a gift only to its recipient.

type ItemView = { slug: string; kind: "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT"; assetKey: string };

export type GiftCatalogProduct = {
  sku: string;
  isBox: boolean;
  priceMinor: number;
  currency: string;
  items: (ItemView & { quantity: number })[];
};

/** The products the gift picker offers (active ones, in catalog order). */
export async function getGiftCatalog(): Promise<{ error: "disabled" } | { error: null; products: GiftCatalogProduct[] }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const products = await prisma.giftProduct.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: {
      sku: true,
      isBox: true,
      webPriceMinor: true,
      currency: true,
      items: {
        where: { item: { active: true } },
        select: { quantity: true, item: { select: { slug: true, kind: true, assetKey: true, sortOrder: true } } },
      },
    },
  });
  return {
    error: null,
    products: products
      .filter((p) => p.items.length > 0)
      .map((p) => ({
        sku: p.sku,
        isBox: p.isBox,
        priceMinor: p.webPriceMinor,
        currency: p.currency,
        items: [...p.items]
          .sort((a, b) => a.item.sortOrder - b.item.sortOrder)
          .map((row) => ({ slug: row.item.slug, kind: row.item.kind, assetKey: row.item.assetKey, quantity: row.quantity })),
      })),
  };
}

export type GiftIntentResult =
  | { error: null; sendId: string; delivered: boolean }
  | {
      error:
        | "disabled"
        | "invalid"
        | "too_long"
        | "rate_limited"
        | "unavailable"
        | "adult_only"
        | "not_accepting"
        | "moderation"
        | "hidden_locked"
        | "not_in_stream";
    };

type GiftPlace = { context: "DIRECT" } | { context: "CHAT"; conversationId: string } | { context: "LIVE"; liveStreamId: string };

/**
 * Asks for a gift of `productSku` to `recipientId`, with an optional note, sent from a profile (DIRECT), a chat
 * (CHAT, the chat gets a gift card) or a live stream (LIVE, the room plays the effect). Every rule is checked before
 * anything is written: the gate, the limits, the product, where it is sent from, blocks either way, age, the
 * recipient's giftsFrom, and the note (at most GIFT_MESSAGE_MAX characters, moderated; flagged text is refused, not
 * stored). Then one PENDING purchase and its send are created and, in Phase 1 (free, admins only), delivered at once
 * through deliverGiftPurchase, the same function the payment phases will call after a confirmed payment.
 */
export async function createGiftIntent(
  productSku: string,
  recipientId: string,
  message: string | null,
  place?: GiftPlace,
): Promise<GiftIntentResult> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const parsed = giftIntentSchema.safeParse({ productSku, recipientId, message, place });
  if (!parsed.success) return { error: "invalid" };
  const where: GiftPlace = parsed.data.place ?? { context: "DIRECT" };
  const note = normalizeGiftMessage(parsed.data.message);
  if (giftMessageRefusal(note)) return { error: "too_long" };
  if (recipientId === user.id) return { error: "invalid" };

  if (!(await checkRateLimit("giftIntent", user.id))) return { error: "rate_limited" };
  if (!(await checkRateLimit("giftToSameRecipient", `${user.id}:${recipientId}`))) return { error: "rate_limited" };

  const [recipient, product] = await Promise.all([
    prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, status: true, isAdmin: true, isGuestPreview: true, birthDate: true, giftsFrom: true },
    }),
    prisma.giftProduct.findFirst({
      where: { sku: parsed.data.productSku, active: true, items: { some: {} }, NOT: { items: { some: { item: { active: false } } } } },
      select: { id: true, currency: true },
    }),
  ]);
  if (!recipient) return { error: "unavailable" };
  if (!product) return { error: "invalid" };

  // Where it is sent from. A chat: a 1:1 both are in, not secret (a server-written card can't go into one) and, if the
  // sender hid it, unlocked. A live stream: live, the recipient is its host, and the sender is in it right now (a row
  // that holds a viewer slot, so the viewer cap already admitted them; nothing here adds a viewer).
  if (where.context === "CHAT") {
    const conversation = await prisma.conversation.findUnique({
      where: { id: where.conversationId },
      select: { isGroup: true, members: { select: { userId: true, e2eeEnabledAt: true, hiddenAt: true } } },
    });
    const mine = conversation?.members.find((m) => m.userId === user.id);
    if (
      !conversation ||
      !mine ||
      conversation.isGroup ||
      conversation.members.length !== 2 ||
      !conversation.members.some((m) => m.userId === recipientId) ||
      isSecretChat(conversation)
    ) {
      return { error: "unavailable" };
    }
    if (await isMembershipLocked(mine, user.id)) return { error: "hidden_locked" };
  } else if (where.context === "LIVE") {
    const now = new Date();
    const stream = await prisma.liveStream.findUnique({
      where: { id: where.liveStreamId },
      select: { id: true, status: true, hostId: true, circleId: true, targetUserId: true },
    });
    if (!stream || stream.status !== "LIVE" || stream.hostId !== recipientId) return { error: "unavailable" };
    if (!(await canAccessLiveStream(stream, user))) return { error: "unavailable" };
    const viewing = await prisma.liveStreamViewer.findUnique({
      where: { liveStreamId_userId: { liveStreamId: stream.id, userId: user.id } },
      select: { role: true, joinedAt: true },
    });
    if (!viewing || !(viewing.role === "COHOST" || holdsViewerSlot(viewing, user.lastSeenAt, now))) {
      return { error: "not_in_stream" };
    }
  }

  const [blocked, connected] = await Promise.all([
    isBlockedEitherWay(user.id, recipientId),
    prisma.connection
      .findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { requesterId: user.id, targetId: recipientId },
            { requesterId: recipientId, targetId: user.id },
          ],
        },
        select: { id: true },
      })
      .then(Boolean),
  ]);
  const refusal = giftSendRefusal({
    sender: user,
    recipient: { ...recipient, giftsFrom: recipient.giftsFrom as GiftsFromValue },
    connected,
    blocked,
    context: where.context,
    now: new Date(),
  });
  if (refusal === "disabled") return { error: "disabled" };
  if (refusal === "self") return { error: "invalid" };
  if (refusal) return { error: refusal };

  if (note !== null && !(await moderateText(note)).allowed) return { error: "moderation" };

  // Phase 1's free path: a grant, recorded as a purchase of 0 so the same delivery (and, later, refund) machinery
  // applies. The provider id is a fresh random one: nothing outside us confirms a grant.
  const purchase = await prisma.giftPurchase.create({
    data: {
      buyerId: user.id,
      productId: product.id,
      provider: "ADMIN_GRANT",
      providerTxnId: randomUUID(),
      status: "PENDING",
      amountMinor: 0,
      currency: product.currency,
      rawRef: "admin-grant",
      send: {
        create: {
          senderId: user.id,
          recipientId,
          message: note,
          messageModeration: "PUBLISHED",
          context: where.context,
          conversationId: where.context === "CHAT" ? where.conversationId : null,
          liveStreamId: where.context === "LIVE" ? where.liveStreamId : null,
          status: "AWAITING_PAYMENT",
        },
      },
    },
    select: { id: true, send: { select: { id: true } } },
  });

  const outcome = await deliverGiftPurchase(purchase.id);
  revalidatePath(`/u/${recipientId}`);
  return { error: null, sendId: purchase.send!.id, delivered: outcome === "delivered" };
}

export type OpenedGift = {
  sendId: string;
  productSku: string;
  isBox: boolean;
  message: string | null;
  senderName: string | null;
  items: ItemView[];
};

const giftViewSelect = {
  id: true,
  status: true,
  message: true,
  recipientId: true,
  senderId: true,
  conversationId: true,
  sender: { select: { name: true } },
  purchase: {
    select: {
      product: {
        select: {
          sku: true,
          isBox: true,
          items: { select: { item: { select: { slug: true, kind: true, assetKey: true, sortOrder: true } } } },
        },
      },
    },
  },
} as const;

function itemsOf(product: { items: { item: ItemView & { sortOrder: number } }[] }): ItemView[] {
  return [...product.items]
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder)
    .map(({ item }) => ({ slug: item.slug, kind: item.kind, assetKey: item.assetKey }));
}

/**
 * The recipient opens a delivered gift: it becomes OPENED (shown on their profile from now on) and its contents come
 * back for the open animation. Idempotent: opening an already-opened gift just shows it again.
 */
export async function openGift(sendId: string): Promise<{ error: "disabled" | "not_found" | "rate_limited" } | { error: null; gift: OpenedGift }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftSendIdSchema.safeParse(sendId);
  if (!id.success) return { error: "not_found" };
  if (!(await checkRateLimit("giftOpen", user.id))) return { error: "rate_limited" };
  const send = await prisma.giftSend.findFirst({ where: { id: id.data, recipientId: user.id }, select: giftViewSelect });
  if (!send || (send.status !== "DELIVERED" && send.status !== "OPENED")) return { error: "not_found" };
  if (send.status === "DELIVERED") {
    await prisma.giftSend.updateMany({
      where: { id: send.id, recipientId: user.id, status: "DELIVERED" },
      data: { status: "OPENED", openedAt: new Date() },
    });
    revalidatePath(`/u/${user.id}`);
  }
  const { product } = send.purchase;
  return {
    error: null,
    gift: {
      sendId: send.id,
      productSku: product.sku,
      isBox: product.isBox,
      message: send.message,
      senderName: send.sender?.name ?? null,
      items: itemsOf(product),
    },
  };
}

/** The recipient takes a gift off their Gifts area (HIDDEN_BY_RECIPIENT). What it gave stays theirs. */
export async function hideGift(sendId: string): Promise<{ error: "disabled" | "not_found" | "rate_limited" | null }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftSendIdSchema.safeParse(sendId);
  if (!id.success) return { error: "not_found" };
  if (!(await checkRateLimit("giftOpen", user.id))) return { error: "rate_limited" };
  const { count } = await prisma.giftSend.updateMany({
    where: { id: id.data, recipientId: user.id, status: { in: ["DELIVERED", "OPENED"] } },
    data: { status: "HIDDEN_BY_RECIPIENT" },
  });
  if (count === 0) return { error: "not_found" };
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** Wears a frame or badge the user owns (an unrevoked copy) on their profile, replacing the one of that kind. */
export async function equipGift(itemSlug: string): Promise<{ error: "disabled" | "not_owned" | "rate_limited" | null }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const slug = giftItemSlugSchema.safeParse(itemSlug);
  if (!slug.success) return { error: "not_owned" };
  if (!(await checkRateLimit("giftOpen", user.id))) return { error: "rate_limited" };
  const item = await prisma.giftItem.findUnique({ where: { slug: slug.data }, select: { id: true, kind: true } });
  const owned = item
    ? await prisma.ownedGift.findMany({
        where: { ownerId: user.id, itemId: item.id, revokedAt: null },
        select: { revokedAt: true },
        take: 1,
      })
    : [];
  if (!item || !canEquip(item, owned)) return { error: "not_owned" };
  await prisma.user.update({
    where: { id: user.id },
    data: item.kind === "FRAME" ? { equippedFrameItemId: item.id } : { equippedBadgeItemId: item.id },
    select: { id: true },
  });
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** Takes off the frame or the badge the user wears. */
export async function unequipGift(kind: "FRAME" | "BADGE"): Promise<{ error: "disabled" | "invalid" | null }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const parsed = giftEquipKindSchema.safeParse(kind);
  if (!parsed.success) return { error: "invalid" };
  await prisma.user.update({
    where: { id: user.id },
    data: parsed.data === "FRAME" ? { equippedFrameItemId: null } : { equippedBadgeItemId: null },
    select: { id: true },
  });
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}

/** Settings -> Gifts: who may send this person a gift (EVERYONE / CONNECTIONS / NOBODY). */
export async function updateGiftsFrom(formData: FormData) {
  const user = await requireUser();
  if (!giftsEnabledFor(user)) redirect("/settings?error=other");
  const parsed = giftsFromSchema.safeParse({ giftsFrom: formData.get("giftsFrom") });
  if (!parsed.success) redirect("/settings?error=invalid");
  await prisma.user.update({ where: { id: user.id }, data: { giftsFrom: parsed.data.giftsFrom }, select: { id: true } });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export type GiftChatCard = {
  sendId: string;
  productSku: string;
  isBox: boolean;
  isRecipient: boolean;
  status: "DELIVERED" | "OPENED" | "HIDDEN";
  message: string | null;
  items: ItemView[];
};

/**
 * The card a chat shows for a gift sent from it (Message.giftSendId). Only for the two people in that chat, only
 * while gifts are on for the viewer, and never across a block; a gift that was revoked or never delivered is just
 * "unavailable".
 */
export async function getGiftChatCard(sendId: string): Promise<{ error: "disabled" | "unavailable" } | { error: null; card: GiftChatCard }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftSendIdSchema.safeParse(sendId);
  if (!id.success) return { error: "unavailable" };
  const send = await prisma.giftSend.findUnique({ where: { id: id.data }, select: giftViewSelect });
  if (!send || !send.conversationId) return { error: "unavailable" };
  if (send.senderId !== user.id && send.recipientId !== user.id) return { error: "unavailable" };
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: send.conversationId, userId: user.id } },
    select: { hiddenAt: true },
  });
  if (!member || (await isMembershipLocked(member, user.id))) return { error: "unavailable" };
  const other = send.senderId === user.id ? send.recipientId : send.senderId;
  if (!other || (await isBlockedEitherWay(user.id, other))) return { error: "unavailable" };
  if (send.status !== "DELIVERED" && send.status !== "OPENED" && send.status !== "HIDDEN_BY_RECIPIENT") {
    return { error: "unavailable" };
  }
  const { product } = send.purchase;
  return {
    error: null,
    card: {
      sendId: send.id,
      productSku: product.sku,
      isBox: product.isBox,
      isRecipient: send.recipientId === user.id,
      status: send.status === "HIDDEN_BY_RECIPIENT" ? "HIDDEN" : send.status,
      message: send.message,
      items: itemsOf(product),
    },
  };
}

/**
 * The gift effects a live room should play: gifts delivered on this stream in the last LIVE_GIFT_EFFECT_WINDOW_MS, by
 * id and effect only (who sent what to whom is never part of it). For anyone who may see the stream and has gifts on.
 */
export async function getLiveGiftEffects(
  liveStreamId: string,
): Promise<{ error: "disabled" | "unavailable" } | { error: null; effects: { id: string; effect: string }[] }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftSendIdSchema.safeParse(liveStreamId);
  if (!id.success) return { error: "unavailable" };
  const stream = await prisma.liveStream.findUnique({
    where: { id: id.data },
    select: { hostId: true, circleId: true, targetUserId: true },
  });
  if (!stream || !(await canAccessLiveStream(stream, user))) return { error: "unavailable" };
  const since = new Date(Date.now() - LIVE_GIFT_EFFECT_WINDOW_MS);
  const sends = await prisma.giftSend.findMany({
    where: { liveStreamId: id.data, context: "LIVE", status: { in: ["DELIVERED", "OPENED", "HIDDEN_BY_RECIPIENT"] }, deliveredAt: { gte: since } },
    orderBy: { deliveredAt: "asc" },
    take: 10,
    select: {
      id: true,
      purchase: { select: { product: { select: { items: { select: { item: { select: { kind: true, assetKey: true } } } } } } } },
    },
  });
  return {
    error: null,
    effects: sends.map((s) => ({ id: s.id, effect: liveEffectFor(s.purchase.product.items.map((row) => row.item)) })),
  };
}
