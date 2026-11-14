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
import { loadGiftOccasions } from "@/lib/gift-occasions-data";
import {
  buildGiftShelves,
  selfOccasionRefusal,
  type GiftShelves,
  type OccasionKind,
} from "@/lib/gift-occasions";
import { GIFT_UNIVERSE_STYLES } from "@/lib/gift-universes";
import {
  GIFT_PRICE_CEILING_MINOR,
  THANK_YOU_SKU,
  giftPieceNumber,
  type GiftRarityName,
  type GiftUniverseName,
} from "@/lib/gifts-data";
import { localDateTime } from "@/lib/birthdays";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import {
  LIVE_GIFT_EFFECT_WINDOW_MS,
  canEquip,
  freeShowcasePosition,
  giftMessageRefusal,
  giftSelfOccasionLockKey,
  giftShowcaseLockKey,
  giftSendRefusal,
  giftsEnabledFor,
  inYearlyWindow,
  isFreeGiftProduct,
  liveEffectFor,
  normalizeGiftMessage,
  showcaseEligible,
  thankYouRefusal,
  type GiftContextValue,
  type GiftsFromValue,
} from "@/lib/gifts";
import {
  giftCatalogSchema,
  giftEquipKindSchema,
  giftFreeSchema,
  giftIntentSchema,
  giftItemSlugSchema,
  giftOccasionSettingsSchema,
  giftOwnedIdSchema,
  giftSelfOccasionKindSchema,
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
  universe: GiftUniverseName;
  rarity: GiftRarityName;
  /** A free kind-words gift (sent with sendFreeGift). */
  free: boolean;
  items: (ItemView & { quantity: number; piece: number | null })[];
};

type Refusal = "disabled" | "unavailable" | "adult_only" | "not_accepting";

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

const recipientSelect = { id: true, status: true, isAdmin: true, isGuestPreview: true, birthDate: true, giftsFrom: true } as const;

type SendParty = { id: string; status: string; isAdmin: boolean; isGuestPreview: boolean; birthDate: Date | null };

/** The send rules (blocks either way, age, the recipient's giftsFrom and gate) for `user` giving `recipient` a gift. */
async function sendRulesRefusal(
  user: SendParty,
  recipient: SendParty & { giftsFrom: string },
  context: GiftContextValue,
): Promise<Refusal | "invalid" | null> {
  const [blocked, connected] = await Promise.all([isBlockedEitherWay(user.id, recipient.id), areConnected(user.id, recipient.id)]);
  const refusal = giftSendRefusal({
    sender: user,
    recipient: { ...recipient, giftsFrom: recipient.giftsFrom as GiftsFromValue },
    connected,
    blocked,
    context,
    now: new Date(),
  });
  if (refusal === "self") return "invalid";
  return refusal;
}

/**
 * The gift picker for one recipient: the products that may be offered and its shelves (src/lib/gift-occasions.ts).
 * Every rule is checked first, on the server, exactly as a send would check it (gate, blocks either way, age, the
 * recipient's giftsFrom): a refusal comes back instead of a catalog, so the picker can say so before anything is
 * chosen. Products: active, every item active, in their yearly window (UTC date), under the price ceiling, a limited
 * edition only while it has copies left (never said how many), price 0 only for an appreciation gift. Then the
 * occasions for this recipient and viewer (computed now, never stored, never notified) decide the "Right now" shelf.
 */
export async function getGiftCatalog(
  recipientId: string,
  context: GiftContextValue = "DIRECT",
): Promise<
  { error: Refusal | "invalid" | "rate_limited" } | { error: null; products: GiftCatalogProduct[]; shelves: GiftShelves }
> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const parsed = giftCatalogSchema.safeParse({ recipientId, context });
  if (!parsed.success || parsed.data.recipientId === user.id) return { error: "invalid" };
  const where = parsed.data.context ?? "DIRECT";
  if (!(await checkRateLimit("giftCatalog", user.id))) return { error: "rate_limited" };

  const recipient = await prisma.user.findUnique({ where: { id: parsed.data.recipientId }, select: recipientSelect });
  if (!recipient) return { error: "unavailable" };
  const refusal = await sendRulesRefusal(user, recipient, where);
  if (refusal) return { error: refusal };

  const now = new Date();
  const today = localDateTime(now, "UTC");
  const [rows, occasions] = await Promise.all([
    prisma.giftProduct.findMany({
      where: { active: true, webPriceMinor: { lte: GIFT_PRICE_CEILING_MINOR } },
      orderBy: { sortOrder: "asc" },
      select: {
        sku: true,
        isBox: true,
        webPriceMinor: true,
        currency: true,
        universe: true,
        rarity: true,
        occasionTags: true,
        availableFrom: true,
        availableUntil: true,
        items: {
          select: {
            quantity: true,
            item: {
              select: {
                id: true,
                slug: true,
                kind: true,
                assetKey: true,
                sortOrder: true,
                active: true,
                rarity: true,
                editionSize: true,
                availableFrom: true,
                availableUntil: true,
              },
            },
          },
        },
      },
    }),
    loadGiftOccasions(recipient.id, user, now),
  ]);

  // Limited editions that have given every copy are simply no longer offered (nothing says how many are left).
  const limited = new Map<string, number>();
  for (const product of rows) {
    for (const { item } of product.items) {
      if (item.rarity === "EDITION" && item.editionSize != null) limited.set(item.id, item.editionSize);
    }
  }
  const soldOut = new Set<string>();
  for (const [itemId, size] of limited) {
    const given = await prisma.ownedGift.count({ where: { itemId, editionNumber: { not: null } } });
    if (given >= size) soldOut.add(itemId);
  }

  const offered = rows.filter(
    (p) =>
      p.items.length > 0 &&
      p.items.every(
        (r) => r.item.active && !soldOut.has(r.item.id) && inYearlyWindow(r.item.availableFrom, r.item.availableUntil, today),
      ) &&
      inYearlyWindow(p.availableFrom, p.availableUntil, today) &&
      (p.webPriceMinor > 0 || isFreeGiftProduct(p)),
  );
  const products: GiftCatalogProduct[] = offered.map((p) => ({
    sku: p.sku,
    isBox: p.isBox,
    priceMinor: p.webPriceMinor,
    currency: p.currency,
    universe: p.universe,
    rarity: p.rarity,
    free: p.webPriceMinor === 0,
    items: [...p.items]
      .sort((a, b) => a.item.sortOrder - b.item.sortOrder)
      .map((row) => ({
        slug: row.item.slug,
        kind: row.item.kind,
        assetKey: row.item.assetKey,
        quantity: row.quantity,
        piece: giftPieceNumber(row.item.slug),
      })),
  }));
  const tagsBySku = new Map(offered.map((p) => [p.sku, p.occasionTags]));
  const shelves = buildGiftShelves(
    products.map((p) => ({ sku: p.sku, universe: p.universe, occasionTags: tagsBySku.get(p.sku) ?? [], free: p.free, items: p.items })),
    occasions,
    where,
  );
  const shown = new Set([...(shelves.rightNow?.skus ?? []), ...shelves.kindWords, ...shelves.universes.flatMap((u) => u.skus)]);
  return { error: null, products: products.filter((p) => shown.has(p.sku)), shelves };
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
      select: { id: true, currency: true, webPriceMinor: true, universe: true, availableFrom: true, availableUntil: true },
    }),
  ]);
  if (!recipient) return { error: "unavailable" };
  if (!product) return { error: "invalid" };
  // A free gift goes through sendFreeGift (its own, stricter limits); out of season isn't offered; and a public live
  // room never gets a Love & Emotion gift.
  if (product.webPriceMinor === 0 || product.webPriceMinor > GIFT_PRICE_CEILING_MINOR) return { error: "invalid" };
  if (!inYearlyWindow(product.availableFrom, product.availableUntil, localDateTime(new Date(), "UTC"))) return { error: "invalid" };
  if (where.context === "LIVE" && product.universe && !GIFT_UNIVERSE_STYLES[product.universe].inLiveRooms) {
    return { error: "invalid" };
  }

  // Where it is sent from. A chat: a 1:1 both are in, not secret (a server-written card can't go into one) and, if the
  // sender hid it, unlocked. A live stream: live, the recipient is its host, and the sender is in it right now (a row
  // that holds a viewer slot, so the viewer cap already admitted them; nothing here adds a viewer).
  if (where.context === "CHAT") {
    const chatRefusal = await chatPlaceRefusal(user.id, recipientId, where.conversationId);
    if (chatRefusal) return { error: chatRefusal };
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

  const refusal = await sendRulesRefusal(user, recipient, where.context);
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

/** Why a gift card can't go into this chat: a 1:1 of these two people, not secret, and unlocked for the sender. */
async function chatPlaceRefusal(
  senderId: string,
  recipientId: string,
  conversationId: string,
): Promise<"unavailable" | "hidden_locked" | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, members: { select: { userId: true, e2eeEnabledAt: true, hiddenAt: true } } },
  });
  const mine = conversation?.members.find((m) => m.userId === senderId);
  if (
    !conversation ||
    !mine ||
    conversation.isGroup ||
    conversation.members.length !== 2 ||
    !conversation.members.some((m) => m.userId === recipientId) ||
    isSecretChat(conversation)
  ) {
    return "unavailable";
  }
  if (await isMembershipLocked(mine, senderId)) return "hidden_locked";
  return null;
}

export type FreeGiftResult =
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
        | "not_found"
        | "already_thanked";
    };

/**
 * Creates and delivers a FREE purchase: the same PENDING purchase + send as a paid gift, delivered by the same
 * deliverGiftPurchase (which knows nothing about payment). Callers have checked every rule and limit first.
 */
async function createFreeSend(input: {
  buyerId: string;
  productId: string;
  currency: string;
  recipientId: string;
  message: string | null;
  context: "DIRECT" | "CHAT";
  conversationId: string | null;
  thanksForSendId?: string;
}) {
  const purchase = await prisma.giftPurchase.create({
    data: {
      buyerId: input.buyerId,
      productId: input.productId,
      provider: "FREE",
      providerTxnId: randomUUID(),
      status: "PENDING",
      amountMinor: 0,
      currency: input.currency,
      rawRef: "free",
      send: {
        create: {
          senderId: input.buyerId,
          recipientId: input.recipientId,
          message: input.message,
          messageModeration: "PUBLISHED",
          context: input.context,
          conversationId: input.conversationId,
          status: "AWAITING_PAYMENT",
          ...(input.thanksForSendId ? { thanksForSendId: input.thanksForSendId } : {}),
        },
      },
    },
    select: { id: true, send: { select: { id: true } } },
  });
  const outcome = await deliverGiftPurchase(purchase.id);
  revalidatePath(`/u/${input.recipientId}`);
  return { sendId: purchase.send!.id, delivered: outcome === "delivered" };
}

/**
 * A free "kind words" gift (Thank You, Appreciate You, Cheering You On, Proud of You): a product priced 0 that carries
 * the appreciation tag, from a profile or a 1:1 chat (never a live room). Exactly the paid gift's rules (gate, blocks
 * either way, age, the recipient's giftsFrom, the chat's), the note moderated, and stricter limits that fail closed
 * with the database fallback (FREE_GIFT_DAILY_MAX in all, FREE_GIFT_PER_RECIPIENT_DAILY_MAX to one person a day). It
 * never asks for, mentions or leads to a payment.
 */
export async function sendFreeGift(
  productSku: string,
  recipientId: string,
  message: string | null,
  place?: { context: "DIRECT" } | { context: "CHAT"; conversationId: string },
): Promise<FreeGiftResult> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const parsed = giftFreeSchema.safeParse({ productSku, recipientId, message, place });
  if (!parsed.success) return { error: "invalid" };
  const where = parsed.data.place ?? { context: "DIRECT" as const };
  const note = normalizeGiftMessage(parsed.data.message);
  if (giftMessageRefusal(note)) return { error: "too_long" };
  if (recipientId === user.id) return { error: "invalid" };

  if (!(await checkRateLimit("giftFreeDaily", user.id))) return { error: "rate_limited" };
  if (!(await checkRateLimit("giftFreeToSameRecipient", `${user.id}:${recipientId}`))) return { error: "rate_limited" };

  const [recipient, product] = await Promise.all([
    prisma.user.findUnique({ where: { id: recipientId }, select: recipientSelect }),
    prisma.giftProduct.findFirst({
      where: {
        sku: parsed.data.productSku,
        active: true,
        webPriceMinor: 0,
        items: { some: {} },
        NOT: { items: { some: { item: { active: false } } } },
      },
      select: { id: true, currency: true, webPriceMinor: true, occasionTags: true },
    }),
  ]);
  if (!recipient) return { error: "unavailable" };
  if (!product || !isFreeGiftProduct(product)) return { error: "invalid" };

  if (where.context === "CHAT") {
    const chatRefusal = await chatPlaceRefusal(user.id, recipientId, where.conversationId);
    if (chatRefusal) return { error: chatRefusal };
  }
  const refusal = await sendRulesRefusal(user, recipient, where.context);
  if (refusal) return { error: refusal };
  if (note !== null && !(await moderateText(note)).allowed) return { error: "moderation" };

  const sent = await createFreeSend({
    buyerId: user.id,
    productId: product.id,
    currency: product.currency,
    recipientId,
    message: note,
    context: where.context,
    conversationId: where.context === "CHAT" ? where.conversationId : null,
  });
  return { error: null, ...sent };
}

/**
 * The recipient of a gift sends one free "Thank You" back for it, once per received gift (GiftSend.thanksForSendId is
 * unique; a second try answers already_thanked). It lands as a card in the chat the gift came from when that chat can
 * still take one, otherwise in the sender's Gifts area. Same rules and free limits as sendFreeGift; a Thank You can't
 * itself be thanked. Nothing about it suggests buying anything.
 */
export async function sendThankYouGift(receivedSendId: string): Promise<FreeGiftResult> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftSendIdSchema.safeParse(receivedSendId);
  if (!id.success) return { error: "not_found" };

  const received = await prisma.giftSend.findUnique({
    where: { id: id.data },
    select: {
      id: true,
      recipientId: true,
      senderId: true,
      status: true,
      thanksForSendId: true,
      conversationId: true,
      thankedBy: { select: { id: true } },
    },
  });
  const why = thankYouRefusal({
    userId: user.id,
    received: received
      ? {
          recipientId: received.recipientId,
          senderId: received.senderId,
          status: received.status,
          thanksForSendId: received.thanksForSendId,
          thanked: received.thankedBy !== null,
        }
      : null,
  });
  if (why || !received?.senderId) return { error: why ?? "unavailable" };
  const thankedId = received.senderId;

  if (!(await checkRateLimit("giftFreeDaily", user.id))) return { error: "rate_limited" };
  if (!(await checkRateLimit("giftFreeToSameRecipient", `${user.id}:${thankedId}`))) return { error: "rate_limited" };

  const [recipient, product] = await Promise.all([
    prisma.user.findUnique({ where: { id: thankedId }, select: recipientSelect }),
    prisma.giftProduct.findFirst({
      where: { sku: THANK_YOU_SKU, active: true, webPriceMinor: 0 },
      select: { id: true, currency: true, webPriceMinor: true, occasionTags: true },
    }),
  ]);
  if (!recipient) return { error: "unavailable" };
  if (!product || !isFreeGiftProduct(product)) return { error: "invalid" };

  // Back into the same chat when it can still take a card; otherwise straight to their Gifts area.
  const conversationId =
    received.conversationId && (await chatPlaceRefusal(user.id, thankedId, received.conversationId)) === null
      ? received.conversationId
      : null;
  const refusal = await sendRulesRefusal(user, recipient, conversationId ? "CHAT" : "DIRECT");
  if (refusal) return { error: refusal };

  try {
    const sent = await createFreeSend({
      buyerId: user.id,
      productId: product.id,
      currency: product.currency,
      recipientId: thankedId,
      message: null,
      context: conversationId ? "CHAT" : "DIRECT",
      conversationId,
      thanksForSendId: received.id,
    });
    revalidatePath(`/u/${user.id}`);
    return { error: null, ...sent };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "already_thanked" };
    throw err;
  }
}

export type OpenedGift = {
  sendId: string;
  productSku: string;
  isBox: boolean;
  message: string | null;
  senderName: string | null;
  /** Phase B: an award the app gave (a challenge win's Champion badge): there is no sender. */
  isAward: boolean;
  items: ItemView[];
  /** The copy numbers of any numbered (EDITION) items in it, for its recipient only. */
  editions: { slug: string; number: number }[];
};

const giftViewSelect = {
  id: true,
  status: true,
  message: true,
  recipientId: true,
  senderId: true,
  conversationId: true,
  thanksForSendId: true,
  thankedBy: { select: { id: true } },
  sender: { select: { name: true } },
  purchase: {
    select: {
      provider: true,
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
  const numbered = await prisma.ownedGift.findMany({
    where: { sendId: send.id, ownerId: user.id, editionNumber: { not: null } },
    select: { editionNumber: true, item: { select: { slug: true } } },
    orderBy: { editionNumber: "asc" },
  });
  return {
    error: null,
    gift: {
      sendId: send.id,
      productSku: product.sku,
      isBox: product.isBox,
      message: send.message,
      senderName: send.sender?.name ?? null,
      isAward: send.purchase.provider === "SYSTEM_AWARD",
      items: itemsOf(product),
      editions: (numbered ?? []).map((row) => ({ slug: row.item.slug, number: row.editionNumber! })),
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
  /** This gift is itself a free Thank You (never thanked back: no loops). */
  isThankYou: boolean;
  /** The recipient may still send one free Thank You back for it. */
  canThank: boolean;
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
      isThankYou: send.thanksForSendId !== null,
      canThank:
        send.recipientId === user.id &&
        send.senderId !== null &&
        send.thanksForSendId === null &&
        send.thankedBy === null &&
        send.status !== "HIDDEN_BY_RECIPIENT",
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

// ---------- Phase A: the occasion chip, Settings, the showcase ----------

/**
 * The occasion chip a 1:1 chat composer may show: the best occasion for the other person, only on an occasion day (a
 * "today" occasion, or a Circle event around now), and only when this viewer could send them a gift from this chat
 * right now. A kind only (the chip words it): never a date. Nothing is stored and nobody is notified.
 */
export async function getGiftOccasionChip(
  recipientId: string,
  conversationId: string,
): Promise<
  { error: "disabled" | "invalid" | "rate_limited" } | { error: null; occasion: { kind: OccasionKind } | null }
> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const r = giftCatalogSchema.safeParse({ recipientId });
  const c = giftSendIdSchema.safeParse(conversationId);
  if (!r.success || !c.success || recipientId === user.id) return { error: "invalid" };
  if (!(await checkRateLimit("giftCatalog", user.id))) return { error: "rate_limited" };
  if (await chatPlaceRefusal(user.id, recipientId, c.data)) return { error: null, occasion: null };
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: recipientSelect });
  if (!recipient || (await sendRulesRefusal(user, recipient, "CHAT"))) return { error: null, occasion: null };
  const occasions = await loadGiftOccasions(recipientId, user);
  const top = occasions.find((o) => o.window === "today" || o.window === "around_now");
  return { error: null, occasion: top ? { kind: top.kind } : null };
}

/** Settings -> Gifts: the connection-anniversary opt-in and the Culture occasion prompts switch. */
export async function updateGiftOccasionSettings(formData: FormData) {
  const user = await requireUser();
  if (!giftsEnabledFor(user)) redirect("/settings?error=other");
  const parsed = giftOccasionSettingsSchema.safeParse({
    anniversaryOptIn: formData.get("anniversaryOptIn") === "on",
    cultureOccasions: formData.get("cultureOccasions") === "on",
  });
  if (!parsed.success) redirect("/settings?error=invalid");
  await prisma.user.update({
    where: { id: user.id },
    data: { giftAnniversaryOptIn: parsed.data.anniversaryOptIn, giftCultureOccasions: parsed.data.cultureOccasions },
    select: { id: true },
  });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

/**
 * Settings -> Gifts -> My occasions: declare a graduation, a new job, an achievement or a milestone for the next 7
 * days. Only about yourself, at most one per kind per 30 days (a removed one still counts), never notified to anyone,
 * stored as a kind and a time only. Rows past the 30 days are deleted on the way.
 */
export async function declareGiftOccasion(formData: FormData) {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) redirect("/settings?error=other");
  const kind = giftSelfOccasionKindSchema.safeParse(formData.get("kind"));
  if (!kind.success) redirect("/settings?error=invalid");
  if (!(await checkRateLimit("giftOccasionDeclare", user.id))) redirect("/settings?error=rate_limited");
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    // One declaration at a time per person, so two quick taps can't both pass the 30-day check.
    const lockKey = giftSelfOccasionLockKey(user.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    // Rows past their 30 days are deleted by the daily prune-gift-occasions cron; selfOccasionRefusal ignores them.
    const existing = await tx.giftSelfOccasion.findMany({
      where: { userId: user.id, kind: kind.data },
      select: { kind: true, declaredAt: true },
    });
    if (selfOccasionRefusal(existing, kind.data, now)) return "too_soon" as const;
    await tx.giftSelfOccasion.create({ data: { userId: user.id, kind: kind.data, declaredAt: now }, select: { id: true } });
    return "ok" as const;
  });
  revalidatePath("/settings");
  redirect(outcome === "ok" ? "/settings?saved=1" : "/settings?error=occasion_too_soon");
}

/** Settings -> Gifts -> My occasions: take a declaration down (it still counts toward the 30 days). */
export async function removeGiftOccasion(formData: FormData) {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) redirect("/settings?error=other");
  const kind = giftSelfOccasionKindSchema.safeParse(formData.get("kind"));
  if (!kind.success) redirect("/settings?error=invalid");
  await prisma.giftSelfOccasion.updateMany({
    where: { userId: user.id, kind: kind.data, removedAt: null },
    data: { removedAt: new Date() },
  });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export type ShowcaseResult = { error: "disabled" | "not_owned" | "full" | "rate_limited" | null };

/**
 * Pins one of the user's own gifts (an OwnedGift: theirs, not revoked, from a gift they opened and haven't hidden) to
 * their profile showcase, at most GIFT_SHOWCASE_MAX. Pins no longer eligible are cleared first. One change at a time
 * per person (advisory lock), so two quick pins can't both take the last place.
 */
export async function pinGiftToShowcase(ownedGiftId: string): Promise<ShowcaseResult> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftOwnedIdSchema.safeParse(ownedGiftId);
  if (!id.success) return { error: "not_owned" };
  if (!(await checkRateLimit("giftOpen", user.id))) return { error: "rate_limited" };
  const outcome = await prisma.$transaction(async (tx): Promise<ShowcaseResult["error"]> => {
    const lockKey = giftShowcaseLockKey(user.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const owned = await tx.ownedGift.findUnique({
      where: { id: id.data },
      select: { id: true, ownerId: true, revokedAt: true, send: { select: { status: true } } },
    });
    if (
      !owned ||
      !showcaseEligible({ ownerId: owned.ownerId, userId: user.id, revokedAt: owned.revokedAt, sendStatus: owned.send.status })
    ) {
      return "not_owned";
    }
    const pins = await tx.giftShowcasePin.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        ownedGiftId: true,
        position: true,
        ownedGift: { select: { ownerId: true, revokedAt: true, send: { select: { status: true } } } },
      },
    });
    if (pins.some((p) => p.ownedGiftId === owned.id)) return null;
    const stale = pins.filter(
      (p) =>
        !showcaseEligible({
          ownerId: p.ownedGift.ownerId,
          userId: user.id,
          revokedAt: p.ownedGift.revokedAt,
          sendStatus: p.ownedGift.send.status,
        }),
    );
    if (stale.length > 0) await tx.giftShowcasePin.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
    const position = freeShowcasePosition(pins.filter((p) => !stale.includes(p)).map((p) => p.position));
    if (position === null) return "full";
    await tx.giftShowcasePin.create({ data: { userId: user.id, ownedGiftId: owned.id, position }, select: { id: true } });
    return null;
  });
  if (outcome === null) revalidatePath(`/u/${user.id}`);
  return { error: outcome };
}

/** Takes a gift off the user's own showcase. */
export async function unpinGiftFromShowcase(ownedGiftId: string): Promise<ShowcaseResult> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const id = giftOwnedIdSchema.safeParse(ownedGiftId);
  if (!id.success) return { error: "not_owned" };
  await prisma.giftShowcasePin.deleteMany({ where: { userId: user.id, ownedGiftId: id.data } });
  revalidatePath(`/u/${user.id}`);
  return { error: null };
}
