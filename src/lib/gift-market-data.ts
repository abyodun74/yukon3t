import { prisma } from "@/lib/prisma";
import { localDateTime } from "@/lib/birthdays";
import { getCoinBalance } from "@/lib/coin-wallet";
import { GIFT_PRICE_CEILING_MINOR, type GiftCategoryName, type GiftTierName } from "@/lib/gifts-data";
import { inYearlyWindow } from "@/lib/gifts";
import { popularRanks, type MarketGift } from "@/lib/gift-market";

// The server half of the gift marketplace's catalog (pure rules: src/lib/gift-market.ts). Called by the marketplace
// pages for a viewer the gift gate (giftsEnabledFor) already let in. It returns the 36 launch gifts (products with a
// category and a coin price), whether each can be sent right now, a popularity ORDER (never a count), the viewer's
// favorites and coin balance. Nothing about any other person.

const productSelect = {
  id: true,
  sku: true,
  coinPrice: true,
  category: true,
  tier: true,
  featured: true,
  sortOrder: true,
  webPriceMinor: true,
  availableFrom: true,
  availableUntil: true,
  items: {
    select: {
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
} as const;

export type GiftMarketplaceData = { gifts: MarketGift[]; favorites: string[]; coinBalance: number };

export async function loadGiftMarketplace(userId: string, now = new Date()): Promise<GiftMarketplaceData> {
  const today = localDateTime(now, "UTC");
  const [rows, favorites, coinBalance] = await Promise.all([
    prisma.giftProduct.findMany({
      // Only active products: a gift an admin switched off is gone from the marketplace (a stale screen that still
      // shows it gets "gift_unavailable" when sending).
      where: { active: true, category: { not: null }, tier: { not: null }, coinPrice: { not: null }, items: { some: {} } },
      orderBy: { sortOrder: "asc" },
      select: productSelect,
    }),
    prisma.giftFavorite.findMany({ where: { userId }, select: { product: { select: { sku: true } } } }),
    getCoinBalance(userId),
  ]);

  const productIds = rows.map((r) => r.id);
  const [given, limitedGiven] = await Promise.all([
    productIds.length
      ? prisma.giftPurchase.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, status: "PAID" },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    countLimitedEditions(rows.flatMap((r) => r.items.map(({ item }) => item))),
  ]);
  const countBySku = new Map<string, number>();
  for (const row of given) {
    const sku = rows.find((r) => r.id === row.productId)?.sku;
    if (sku) countBySku.set(sku, row._count._all);
  }
  const ranks = popularRanks(
    rows.map((r) => r.sku),
    countBySku,
  );

  const gifts: MarketGift[] = rows.map((p) => {
    const items = [...p.items].sort((a, b) => a.item.sortOrder - b.item.sortOrder).map(({ item }) => item);
    const seasonal = Boolean(p.availableFrom || p.availableUntil || items.some((i) => i.availableFrom || i.availableUntil));
    const numbered = items.some((i) => i.rarity === "EDITION");
    const available =
      p.webPriceMinor > 0 &&
      p.webPriceMinor <= GIFT_PRICE_CEILING_MINOR &&
      inYearlyWindow(p.availableFrom, p.availableUntil, today) &&
      items.every((i) => i.active && inYearlyWindow(i.availableFrom, i.availableUntil, today) && !limitedGiven.has(i.id));
    return {
      sku: p.sku,
      category: p.category as GiftCategoryName,
      tier: p.tier as GiftTierName,
      coinPrice: p.coinPrice as number,
      featured: p.featured,
      numberedOrSeasonal: numbered || seasonal,
      available,
      popularRank: ranks.get(p.sku) ?? rows.length,
      addedOrder: p.sortOrder,
      items: items.map((i) => ({ slug: i.slug, kind: i.kind, assetKey: i.assetKey })),
    };
  });

  return { gifts, favorites: favorites.map((f) => f.product.sku), coinBalance };
}

/** The ids of limited (EDITION with a size) items that have given every copy. Never said how many are left. */
async function countLimitedEditions(items: { id: string; rarity: string; editionSize: number | null }[]): Promise<Set<string>> {
  const limited = new Map(items.filter((i) => i.rarity === "EDITION" && i.editionSize != null).map((i) => [i.id, i.editionSize!]));
  const soldOut = new Set<string>();
  for (const [itemId, size] of limited) {
    const count = await prisma.ownedGift.count({ where: { itemId, editionNumber: { not: null } } });
    if (count >= size) soldOut.add(itemId);
  }
  return soldOut;
}
