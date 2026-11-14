import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { showcaseEligible } from "@/lib/gifts";
import { giftItemName, giftProductName } from "@/lib/gift-names";
import { giftsEn } from "@/lib/i18n/en/gifts";
import type { HiddenState } from "@/lib/hidden-chats-rules";

// The "Gifts and challenges" part of "Export my data" (exportMyData, src/app/actions/profile.ts). Only the requester's
// own data, and only what the app already shows them: exact `select`s, never a User row, never anyone's email/phone/
// birth date, never a purchase/provider record. Nobody blocked either way with the requester is named, and (unless
// the hidden-chats PIN unlock is live, which the caller decides by passing an empty HiddenState) anything sent in a
// hidden conversation or to/from a hidden peer is left out, and a hidden peer is never named.

/** Most recent rows per list; a longer history is cut with `truncated: true` (the export stays a reasonable size). */
export const GIFT_EXPORT_LIMITS = {
  giftsSent: 500,
  giftsReceived: 500,
  selfOccasions: 100,
  challengesHosted: 200,
  challengesJoined: 500,
} as const;

export type ExportList<T> = { items: T[]; truncated: boolean; limit: number };

/** Rows read with `take: limit + 1`: at most `limit` kept, and whether there were more. */
export function capList<T>(rows: T[], limit: number): ExportList<T> {
  return { items: rows.slice(0, limit), truncated: rows.length > limit, limit };
}

type ItemRow = { slug: string; kind: string; universe: string };
const itemSelect = { slug: true, kind: true, universe: true } as const;
const itemView = (item: ItemRow) => ({ name: giftItemName(giftsEn, item.slug), slug: item.slug, kind: item.kind, universe: item.universe });

type ProductRow = { sku: string; isBox: boolean; universe: string; items: { quantity: number; item: ItemRow }[] };
const productSelect = {
  sku: true,
  isBox: true,
  universe: true,
  items: { select: { quantity: true, item: { select: itemSelect } } },
} as const;
const productView = (product: ProductRow) => ({
  name: giftProductName(giftsEn, { sku: product.sku, isBox: product.isBox, items: product.items.map(({ item }) => item) }),
  sku: product.sku,
  isBox: product.isBox,
  universe: product.universe,
  items: product.items.map(({ quantity, item }) => ({ ...itemView(item), quantity })),
});

/**
 * A sent gift's status as its sender can see it in the app. Only a gift sent in a chat shows its state afterwards (the
 * chat card: unopened / opened / hidden, "unavailable" once revoked); a gift sent from a profile or a live room shows
 * the sender nothing after it was given, so opened/hidden there read as DELIVERED. A revoked gift is "UNAVAILABLE"
 * (the sender is never told it was reported or revoked).
 */
export function senderSideGiftStatus(
  status: string,
  context: string,
): "PENDING" | "NOT_DELIVERED" | "DELIVERED" | "OPENED" | "HIDDEN" | "UNAVAILABLE" {
  switch (status) {
    case "AWAITING_PAYMENT":
      return "PENDING";
    case "UNDELIVERABLE":
      return "NOT_DELIVERED";
    case "REVOKED":
      return "UNAVAILABLE";
    case "OPENED":
      return context === "CHAT" ? "OPENED" : "DELIVERED";
    case "HIDDEN_BY_RECIPIENT":
      return context === "CHAT" ? "HIDDEN" : "DELIVERED";
    default:
      return "DELIVERED";
  }
}

export type ReceivedFrom = { name: string | null } | "award" | "deleted" | "not_shown";

/**
 * Who a received gift is from, exactly as the recipient's own Gifts area / open view shows it (src/lib/gift-profile.ts:
 * the sender's display name only, never a username; "award" for a Champion badge the app gave; "deleted" when the
 * sender's account is gone), and only while the gift is DELIVERED or OPENED (the app shows nothing for a hidden or
 * revoked one). Never named across a block either way or when the sender is a hidden peer: "not_shown".
 */
export function receivedGiftFrom(input: {
  status: string;
  provider: string;
  sender: { id: string; name: string | null } | null;
  withheldIds: ReadonlySet<string>;
}): ReceivedFrom {
  if (input.status !== "DELIVERED" && input.status !== "OPENED") return "not_shown";
  if (input.provider === "SYSTEM_AWARD") return "award";
  if (!input.sender) return "deleted";
  if (input.withheldIds.has(input.sender.id)) return "not_shown";
  return { name: input.sender.name };
}

type Person = { id: string; name: string | null; username: string | null; status: string };
const personSelect = { select: { id: true, name: true, username: true, status: true } } as const;

/** Display name + username of someone still on YuKon3t (ACTIVE) who isn't blocked either way / a hidden peer. */
export function namedPerson(person: Person | null, withheldIds: ReadonlySet<string>): { name: string | null; username: string | null } | "not_shown" {
  if (!person || person.status !== "ACTIVE" || withheldIds.has(person.id)) return "not_shown";
  return { name: person.name, username: person.username };
}

export async function loadGiftExport(userId: string, hidden: HiddenState) {
  const blocked = await getBlockedEitherWayIds(userId);
  const withheld = new Set<string>([...blocked, ...hidden.peerIds]);
  const L = GIFT_EXPORT_LIMITS;
  // A gift tied to a hidden conversation, or to/from a hidden peer, is left out entirely (like sentMessages).
  // conversationId is null for a gift not sent in a chat: a bare notIn would drop those too.
  const notInHiddenChat =
    hidden.conversationIds.length > 0
      ? [{ OR: [{ conversationId: null }, { conversationId: { notIn: hidden.conversationIds } }] }]
      : [];

  const [settings, pins, selfOccasions, sent, received, hosted, joined, wins] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        giftsFrom: true,
        giftAnniversaryOptIn: true,
        giftCultureOccasions: true,
        equippedFrameItem: { select: itemSelect },
        equippedBadgeItem: { select: itemSelect },
      },
    }),
    prisma.giftShowcasePin.findMany({
      where: { userId },
      orderBy: { position: "asc" },
      select: {
        position: true,
        createdAt: true,
        ownedGift: {
          select: { ownerId: true, revokedAt: true, editionNumber: true, send: { select: { status: true } }, item: { select: itemSelect } },
        },
      },
    }),
    prisma.giftSelfOccasion.findMany({
      where: { userId },
      orderBy: { declaredAt: "desc" },
      take: L.selfOccasions + 1,
      select: { kind: true, declaredAt: true, removedAt: true },
    }),
    prisma.giftSend.findMany({
      where: {
        senderId: userId,
        AND: [
          ...notInHiddenChat,
          ...(hidden.peerIds.length > 0 ? [{ recipientId: { notIn: hidden.peerIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: L.giftsSent + 1,
      select: {
        message: true,
        context: true,
        status: true,
        createdAt: true,
        deliveredAt: true,
        openedAt: true,
        thanksForSendId: true,
        recipient: personSelect,
        purchase: { select: { product: { select: productSelect } } },
      },
    }),
    prisma.giftSend.findMany({
      where: {
        recipientId: userId,
        // Only gifts the recipient was ever given (never one still awaiting payment or refused at delivery).
        status: { in: ["DELIVERED", "OPENED", "HIDDEN_BY_RECIPIENT", "REVOKED"] },
        deliveredAt: { not: null },
        AND: [
          ...notInHiddenChat,
          // senderId is null for an award or a deleted sender: a bare notIn would drop those too.
          ...(hidden.peerIds.length > 0 ? [{ OR: [{ senderId: null }, { senderId: { notIn: hidden.peerIds } }] }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: L.giftsReceived + 1,
      select: {
        message: true,
        context: true,
        status: true,
        deliveredAt: true,
        openedAt: true,
        revokedAt: true,
        thanksForSendId: true,
        sender: { select: { id: true, name: true } },
        purchase: { select: { provider: true, product: { select: productSelect } } },
        owned: {
          where: { ownerId: userId },
          select: { editionNumber: true, revokedAt: true, item: { select: { slug: true } } },
        },
      },
    }),
    prisma.challenge.findMany({
      where: { hostId: userId },
      orderBy: { createdAt: "desc" },
      take: L.challengesHosted + 1,
      select: {
        title: true,
        description: true,
        status: true,
        circleId: true,
        createdAt: true,
        decidedAt: true,
        cancelledAt: true,
        _count: { select: { participants: true } },
        winners: { orderBy: { createdAt: "asc" }, select: { user: personSelect } },
      },
    }),
    prisma.challengeParticipant.findMany({
      where: { userId },
      orderBy: { joinedAt: "desc" },
      take: L.challengesJoined + 1,
      select: { joinedAt: true, challengeId: true },
    }),
    prisma.challengeWinner.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: L.challengesJoined + 1,
      select: { challengeId: true, createdAt: true },
    }),
  ]);

  // Challenges joined or won (a winner may have left the participant list since): one entry each. As in the app, a
  // challenge whose host is blocked either way with the requester is left out (the app doesn't show it at all).
  const joinedAt = new Map(joined.map((row) => [row.challengeId, row.joinedAt]));
  const wonIds = new Set(wins.map((row) => row.challengeId));
  const challengeIds = [...new Set([...joinedAt.keys(), ...wonIds])];
  const joinedChallenges = challengeIds.length
    ? await prisma.challenge.findMany({
        where: {
          id: { in: challengeIds },
          ...(blocked.size > 0 ? { OR: [{ hostId: null }, { hostId: { notIn: [...blocked] } }] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: L.challengesJoined + 1,
        select: { id: true, title: true, status: true, circleId: true, createdAt: true, decidedAt: true, cancelledAt: true },
      })
    : [];
  const joinedTruncated = joined.length > L.challengesJoined || wins.length > L.challengesJoined;
  const joinedList = capList(
    joinedChallenges.map((c) => ({
      title: c.title,
      status: c.status,
      context: c.circleId ? ("CIRCLE" as const) : ("LIVE" as const),
      role: wonIds.has(c.id) && !joinedAt.has(c.id) ? ("winner" as const) : ("participant" as const),
      joinedAt: joinedAt.get(c.id) ?? null,
      // Same as the app's "You won": a decided challenge with this person among its current winners.
      won: c.status === "DECIDED" && wonIds.has(c.id),
      createdAt: c.createdAt,
      decidedAt: c.decidedAt,
      cancelledAt: c.cancelledAt,
    })),
    L.challengesJoined,
  );

  return {
    settings: settings
      ? {
          giftsFrom: settings.giftsFrom,
          anniversaryOptIn: settings.giftAnniversaryOptIn,
          cultureOccasionPrompts: settings.giftCultureOccasions,
        }
      : null,
    equipped: {
      frame: settings?.equippedFrameItem ? itemView(settings.equippedFrameItem) : null,
      badge: settings?.equippedBadgeItem ? itemView(settings.equippedBadgeItem) : null,
    },
    showcase: pins
      .filter(({ ownedGift }) =>
        showcaseEligible({ ownerId: ownedGift.ownerId, userId, revokedAt: ownedGift.revokedAt, sendStatus: ownedGift.send.status }),
      )
      .map(({ position, createdAt, ownedGift }) => ({
        position,
        pinnedAt: createdAt,
        item: itemView(ownedGift.item),
        editionNumber: ownedGift.editionNumber,
      })),
    selfOccasions: capList(selfOccasions, L.selfOccasions),
    giftsSent: capList(
      sent.map((send) => {
        const status = senderSideGiftStatus(send.status, send.context);
        return {
          gift: productView(send.purchase.product),
          to: namedPerson(send.recipient, withheld),
          context: send.context,
          note: send.message,
          isThankYou: send.thanksForSendId !== null,
          status,
          sentAt: send.createdAt,
          deliveredAt: send.deliveredAt,
          openedAt: status === "OPENED" ? send.openedAt : null,
        };
      }),
      L.giftsSent,
    ),
    giftsReceived: capList(
      received.map((send) => {
        const shown = send.status === "DELIVERED" || send.status === "OPENED";
        return {
          gift: productView(send.purchase.product),
          from: receivedGiftFrom({
            status: send.status,
            provider: send.purchase.provider,
            sender: send.sender,
            withheldIds: withheld,
          }),
          // The note is shown to the recipient when they open the gift; nothing of a hidden or revoked one.
          note: shown ? send.message : null,
          context: send.context,
          isThankYou: send.thanksForSendId !== null,
          status: send.status === "HIDDEN_BY_RECIPIENT" ? "HIDDEN" : send.status,
          hidden: send.status === "HIDDEN_BY_RECIPIENT",
          revoked: send.status === "REVOKED" || send.revokedAt !== null,
          receivedAt: send.deliveredAt,
          openedAt: send.openedAt,
          copies: send.owned.map((row) => ({
            item: row.item.slug,
            editionNumber: row.editionNumber,
            revoked: row.revokedAt !== null,
          })),
        };
      }),
      L.giftsReceived,
    ),
    challengesHosted: capList(
      hosted.map((c) => ({
        title: c.title,
        description: c.description,
        status: c.status,
        context: c.circleId ? ("CIRCLE" as const) : ("LIVE" as const),
        createdAt: c.createdAt,
        decidedAt: c.decidedAt,
        cancelledAt: c.cancelledAt,
        participantCount: c._count.participants,
        winners: c.winners.map((w) => namedPerson(w.user, withheld)),
      })),
      L.challengesHosted,
    ),
    challengesJoined: { ...joinedList, truncated: joinedList.truncated || joinedTruncated },
  };
}
