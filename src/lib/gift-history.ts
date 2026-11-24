import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getHiddenState } from "@/lib/hidden-chats";
import { namedPerson, receivedGiftFrom, senderSideGiftStatus } from "@/lib/gift-export";
import { COIN_CURRENCY } from "@/lib/coins";

// The marketplace's gift history (sent / received), for the signed-in person only. The same rules as their Gifts area
// and "Export my data" (src/lib/gift-export.ts): a recipient or sender is named only while ACTIVE and not blocked
// either way; the sender of a received gift only as the Gifts area names them; anything sent in a hidden chat or
// to/from a hidden peer is left out (this list is outside /messages/hidden, so it never hints at one). A sent gift
// shows its status only as its sender could see it in the app. Exact selects; never a User row.

export const GIFT_HISTORY_LIMIT = 50;

type ItemView = { slug: string; kind: "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT"; assetKey: string };

export type SentGiftEntry = {
  sendId: string;
  productSku: string;
  isBox: boolean;
  items: ItemView[];
  quantity: number;
  /** Coins spent (null for a free gift or one sent before coins). */
  coins: number | null;
  to: { name: string | null; username: string | null } | "not_shown";
  status: ReturnType<typeof senderSideGiftStatus>;
  createdAt: string;
};

export type ReceivedGiftEntry = {
  sendId: string;
  productSku: string;
  isBox: boolean;
  items: ItemView[];
  quantity: number;
  from: ReturnType<typeof receivedGiftFrom>;
  status: "DELIVERED" | "OPENED";
  message: string | null;
  deliveredAt: string | null;
};

const productSelect = {
  sku: true,
  isBox: true,
  items: { select: { item: { select: { slug: true, kind: true, assetKey: true, sortOrder: true } } } },
} as const;

function itemsOf(product: { items: { item: ItemView & { sortOrder: number } }[] }): ItemView[] {
  return [...product.items]
    .sort((a, b) => a.item.sortOrder - b.item.sortOrder)
    .map(({ item }) => ({ slug: item.slug, kind: item.kind, assetKey: item.assetKey }));
}

/** Filters that leave out gifts tied to a hidden chat or a hidden peer (see the header). */
function notHidden(hidden: { conversationIds: string[]; peerIds: string[] }, peerField: "recipientId" | "senderId") {
  const and: object[] = [];
  if (hidden.conversationIds.length > 0) {
    and.push({ OR: [{ conversationId: null }, { conversationId: { notIn: hidden.conversationIds } }] });
  }
  if (hidden.peerIds.length > 0) {
    and.push(
      peerField === "senderId"
        ? { OR: [{ senderId: null }, { senderId: { notIn: hidden.peerIds } }] }
        : { recipientId: { notIn: hidden.peerIds } },
    );
  }
  return and;
}

export async function loadSentGifts(userId: string): Promise<SentGiftEntry[]> {
  const [hidden, blocked] = await Promise.all([getHiddenState(userId), getBlockedEitherWayIds(userId)]);
  const withheld = new Set<string>([...blocked, ...hidden.peerIds]);
  const rows = await prisma.giftSend.findMany({
    where: { senderId: userId, AND: notHidden(hidden, "recipientId") },
    orderBy: { createdAt: "desc" },
    take: GIFT_HISTORY_LIMIT,
    select: {
      id: true,
      context: true,
      status: true,
      createdAt: true,
      recipient: { select: { id: true, name: true, username: true, status: true } },
      purchase: { select: { provider: true, amountMinor: true, currency: true, quantity: true, product: { select: productSelect } } },
    },
  });
  return rows.map((row) => ({
    sendId: row.id,
    productSku: row.purchase.product.sku,
    isBox: row.purchase.product.isBox,
    items: itemsOf(row.purchase.product),
    quantity: row.purchase.quantity,
    coins: row.purchase.provider === "COINS" && row.purchase.currency === COIN_CURRENCY ? row.purchase.amountMinor : null,
    to: namedPerson(row.recipient, withheld),
    status: senderSideGiftStatus(row.status, row.context),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function loadReceivedGifts(userId: string): Promise<ReceivedGiftEntry[]> {
  const [hidden, blocked] = await Promise.all([getHiddenState(userId), getBlockedEitherWayIds(userId)]);
  const withheld = new Set<string>([...blocked, ...hidden.peerIds]);
  const rows = await prisma.giftSend.findMany({
    // What the recipient's Gifts area shows: delivered or opened (hidden and revoked ones aren't listed there either).
    where: { recipientId: userId, status: { in: ["DELIVERED", "OPENED"] }, AND: notHidden(hidden, "senderId") },
    orderBy: { createdAt: "desc" },
    take: GIFT_HISTORY_LIMIT,
    select: {
      id: true,
      status: true,
      message: true,
      deliveredAt: true,
      sender: { select: { id: true, name: true } },
      purchase: { select: { provider: true, quantity: true, product: { select: productSelect } } },
    },
  });
  return rows.map((row) => {
    const from = receivedGiftFrom({ status: row.status, provider: row.purchase.provider, sender: row.sender, withheldIds: withheld });
    return {
      sendId: row.id,
      productSku: row.purchase.product.sku,
      isBox: row.purchase.product.isBox,
      items: itemsOf(row.purchase.product),
      quantity: row.purchase.quantity,
      from,
      status: row.status as "DELIVERED" | "OPENED",
      // The note is shown to its recipient only, and never once the sender is withheld (blocked / hidden peer).
      message: from === "not_shown" ? null : row.message,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
    };
  });
}
