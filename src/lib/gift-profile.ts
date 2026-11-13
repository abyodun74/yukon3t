import { prisma } from "@/lib/prisma";
import { giftsEnabledFor, giftVisibleOnProfile, isEquippableKind, showcaseEligible } from "@/lib/gifts";

// What a profile shows of digital gifts (src/lib/gifts.ts): the frame around the avatar, the badge by the name, and
// the Gifts area. Server-only; the page hands the result to client components, so it carries only what they render.
// Nothing at all unless gifts are on for both the viewer and the owner, and nothing across a block either way. Only
// the owner (the recipient) is told who sent a gift.

type ItemView = { slug: string; kind: "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT"; assetKey: string };

export type ProfileGift = {
  sendId: string;
  status: "DELIVERED" | "OPENED";
  productSku: string;
  isBox: boolean;
  items: ItemView[];
  /** Owner only: the sender's name (null: no name), or "deleted" when their account is gone. Visitors: undefined. */
  sender?: { name: string | null } | "deleted";
  /** Owner only, opened gifts: each owned copy, to pin to the showcase (and its edition number, if numbered). */
  owned?: { id: string; slug: string; assetKey: string; editionNumber: number | null; pinned: boolean }[];
  /** Owner only: a free Thank You can still be sent back for it. */
  thankable?: boolean;
};

/** One gift on the profile showcase. Visitors get the item only: never the sender, never an edition number. */
export type ShowcaseGift = ItemView & { ownedGiftId?: string; editionNumber?: number | null };

export type ProfileGiftsView = {
  frame: ItemView | null;
  badge: ItemView | null;
  gifts: ProfileGift[];
  /** Owner only: the frames and badges they own (unrevoked), to wear or take off. */
  wearable: ItemView[];
  /** Up to GIFT_SHOWCASE_MAX pinned gifts, in position order; revoked or hidden ones are left out. */
  showcase: ShowcaseGift[];
};

const PROFILE_GIFTS_LIMIT = 50;
const itemSelect = { slug: true, kind: true, assetKey: true, sortOrder: true } as const;

export async function loadProfileGifts(
  owner: {
    id: string;
    isAdmin: boolean;
    isGuestPreview: boolean;
    equippedFrameItemId: string | null;
    equippedBadgeItemId: string | null;
  },
  viewer: { id: string; isAdmin: boolean; isGuestPreview: boolean },
  blockedEitherWay: boolean,
): Promise<ProfileGiftsView | null> {
  if (!giftsEnabledFor(viewer) || !giftsEnabledFor(owner)) return null;
  const isOwner = owner.id === viewer.id;
  if (!isOwner && blockedEitherWay) return null;

  const equippedIds = [owner.equippedFrameItemId, owner.equippedBadgeItemId].filter((id): id is string => id !== null);
  const [equipped, sends, owned, pins] = await Promise.all([
    equippedIds.length
      ? prisma.giftItem.findMany({ where: { id: { in: equippedIds } }, select: { id: true, ...itemSelect } })
      : [],
    prisma.giftSend.findMany({
      where: { recipientId: owner.id, status: isOwner ? { in: ["DELIVERED", "OPENED"] } : "OPENED" },
      orderBy: { createdAt: "desc" },
      take: PROFILE_GIFTS_LIMIT,
      select: {
        id: true,
        status: true,
        senderId: true,
        thanksForSendId: true,
        thankedBy: { select: { id: true } },
        sender: { select: { name: true } },
        // The owner's own copies (to pin); for a visitor the filter matches nothing, so nothing is read.
        owned: {
          where: isOwner ? { ownerId: owner.id, revokedAt: null } : { id: { in: [] } },
          select: {
            id: true,
            editionNumber: true,
            showcasePin: { select: { id: true } },
            item: { select: { slug: true, assetKey: true } },
          },
        },
        purchase: {
          select: { product: { select: { sku: true, isBox: true, items: { select: { item: { select: itemSelect } } } } } },
        },
      },
    }),
    isOwner
      ? prisma.ownedGift.findMany({
          where: { ownerId: owner.id, revokedAt: null, item: { kind: { in: ["FRAME", "BADGE"] } } },
          distinct: ["itemId"],
          select: { item: { select: itemSelect } },
        })
      : [],
    prisma.giftShowcasePin.findMany({
      where: { userId: owner.id },
      orderBy: { position: "asc" },
      select: {
        ownedGift: {
          select: {
            id: true,
            ownerId: true,
            revokedAt: true,
            editionNumber: true,
            send: { select: { status: true } },
            item: { select: itemSelect },
          },
        },
      },
    }),
  ]);

  const view = (item: ItemView & { sortOrder?: number }): ItemView => ({ slug: item.slug, kind: item.kind, assetKey: item.assetKey });
  const frameRow = equipped.find((item) => item.id === owner.equippedFrameItemId && item.kind === "FRAME");
  const badgeRow = equipped.find((item) => item.id === owner.equippedBadgeItemId && item.kind === "BADGE");

  return {
    frame: frameRow ? view(frameRow) : null,
    badge: badgeRow ? view(badgeRow) : null,
    gifts: sends
      .filter((send) => giftVisibleOnProfile({ status: send.status, viewerIsRecipient: isOwner, blocked: false }))
      .map((send) => ({
        sendId: send.id,
        status: send.status as "DELIVERED" | "OPENED",
        productSku: send.purchase.product.sku,
        isBox: send.purchase.product.isBox,
        items: [...send.purchase.product.items].sort((a, b) => a.item.sortOrder - b.item.sortOrder).map(({ item }) => view(item)),
        ...(isOwner
          ? {
              sender: send.sender ? { name: send.sender.name } : ("deleted" as const),
              owned:
                send.status === "OPENED"
                  ? send.owned.map((row) => ({
                      id: row.id,
                      slug: row.item.slug,
                      assetKey: row.item.assetKey,
                      editionNumber: row.editionNumber,
                      pinned: row.showcasePin !== null,
                    }))
                  : [],
              thankable: send.senderId !== null && send.thanksForSendId === null && send.thankedBy === null,
            }
          : {}),
      })),
    wearable: owned
      .map(({ item }) => item)
      .filter((item) => isEquippableKind(item.kind))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(view),
    showcase: pins
      .map(({ ownedGift }) => ownedGift)
      .filter((row) =>
        showcaseEligible({ ownerId: row.ownerId, userId: owner.id, revokedAt: row.revokedAt, sendStatus: row.send.status }),
      )
      .map((row) => ({
        ...view(row.item),
        ...(isOwner ? { ownedGiftId: row.id, editionNumber: row.editionNumber } : {}),
      })),
  };
}
