import { prisma } from "@/lib/prisma";
import { giftsEnabledFor, giftVisibleOnProfile, isEquippableKind } from "@/lib/gifts";

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
};

export type ProfileGiftsView = {
  frame: ItemView | null;
  badge: ItemView | null;
  gifts: ProfileGift[];
  /** Owner only: the frames and badges they own (unrevoked), to wear or take off. */
  wearable: ItemView[];
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
  const [equipped, sends, owned] = await Promise.all([
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
        sender: { select: { name: true } },
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
        ...(isOwner ? { sender: send.sender ? { name: send.sender.name } : ("deleted" as const) } : {}),
      })),
    wearable: owned
      .map(({ item }) => item)
      .filter((item) => isEquippableKind(item.kind))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(view),
  };
}
