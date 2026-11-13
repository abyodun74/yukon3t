// The digital-gift catalog (src/lib/gifts.ts), as data. Pure and client-safe. The database rows are seeded from
// exactly this by migration 20261112180300_gifts_catalog_seed (gifts-data.test.ts checks that the SQL names every item,
// product and box content listed here), and the actions read the database, never this file, for what can be sent: a
// product an admin switches off (GiftProduct.active) can't be sent whatever this says.
//
// Prices are the store price tiers in USD, in minor units (cents), as GiftProduct.webPriceMinor. Store product ids
// (GiftProduct.appleProductId / googleProductId) are set in the payments phases, once the products exist in App Store
// Connect and the Play Console.
//
// Names and descriptions are in the `gifts` dictionary (src/lib/i18n/<lang>/gifts.ts) under `items.<slug>` and
// `products.<sku>`, in every language. Art is drawn by the app (src/components/gift-art.tsx) from `assetKey`.

export type GiftItemKindName = "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT";

export type GiftItemDef = { slug: string; kind: GiftItemKindName; assetKey: string; sortOrder: number };
export type GiftProductDef = {
  sku: string;
  isBox: boolean;
  webPriceMinor: number;
  currency: "USD";
  sortOrder: number;
  items: { slug: string; quantity: number }[];
};

export const GIFT_ITEMS = [
  { slug: "wave", kind: "STICKER", assetKey: "wave", sortOrder: 10 },
  { slug: "heart-burst", kind: "STICKER", assetKey: "heart-burst", sortOrder: 20 },
  { slug: "high-five", kind: "STICKER", assetKey: "high-five", sortOrder: 30 },
  { slug: "coffee", kind: "STICKER", assetKey: "coffee", sortOrder: 40 },
  { slug: "rose", kind: "STICKER", assetKey: "rose", sortOrder: 50 },
  { slug: "supporter-star", kind: "BADGE", assetKey: "supporter-star", sortOrder: 60 },
  { slug: "kindred-spirit", kind: "BADGE", assetKey: "kindred-spirit", sortOrder: 70 },
  { slug: "aurora-frame", kind: "FRAME", assetKey: "aurora-frame", sortOrder: 80 },
  { slug: "frost-frame", kind: "FRAME", assetKey: "frost-frame", sortOrder: 90 },
  { slug: "gold-ring-frame", kind: "FRAME", assetKey: "gold-ring-frame", sortOrder: 100 },
  { slug: "confetti", kind: "LIVE_EFFECT", assetKey: "confetti", sortOrder: 110 },
  { slug: "aurora-sweep", kind: "LIVE_EFFECT", assetKey: "aurora-sweep", sortOrder: 120 },
] as const satisfies readonly GiftItemDef[];

export type GiftItemSlug = (typeof GIFT_ITEMS)[number]["slug"];

const single = (sku: string, slug: GiftItemSlug, webPriceMinor: number, sortOrder: number): GiftProductDef => ({
  sku,
  isBox: false,
  webPriceMinor,
  currency: "USD",
  sortOrder,
  items: [{ slug, quantity: 1 }],
});

export const GIFT_PRODUCTS = [
  single("sticker.wave", "wave", 99, 10),
  single("sticker.heart-burst", "heart-burst", 99, 20),
  single("sticker.high-five", "high-five", 99, 30),
  single("sticker.coffee", "coffee", 99, 40),
  single("sticker.rose", "rose", 99, 50),
  single("badge.supporter-star", "supporter-star", 199, 60),
  single("badge.kindred-spirit", "kindred-spirit", 199, 70),
  single("frame.aurora", "aurora-frame", 299, 80),
  single("frame.frost", "frost-frame", 299, 90),
  single("frame.gold-ring", "gold-ring-frame", 299, 100),
  single("live.confetti", "confetti", 199, 110),
  single("live.aurora-sweep", "aurora-sweep", 499, 120),
  {
    sku: "box.say-hi",
    isBox: true,
    webPriceMinor: 199,
    currency: "USD",
    sortOrder: 200,
    items: [
      { slug: "wave", quantity: 1 },
      { slug: "high-five", quantity: 1 },
      { slug: "coffee", quantity: 1 },
    ],
  },
  {
    sku: "box.celebration",
    isBox: true,
    webPriceMinor: 499,
    currency: "USD",
    sortOrder: 210,
    items: [
      { slug: "heart-burst", quantity: 1 },
      { slug: "rose", quantity: 1 },
      { slug: "confetti", quantity: 1 },
      { slug: "gold-ring-frame", quantity: 1 },
    ],
  },
  {
    sku: "box.aurora",
    isBox: true,
    webPriceMinor: 799,
    currency: "USD",
    sortOrder: 220,
    items: [
      { slug: "aurora-frame", quantity: 1 },
      { slug: "aurora-sweep", quantity: 1 },
      { slug: "supporter-star", quantity: 1 },
      { slug: "wave", quantity: 1 },
    ],
  },
] as const satisfies readonly GiftProductDef[];

export type GiftProductSku = (typeof GIFT_PRODUCTS)[number]["sku"];

/** The fixed database id of a catalog row (the seed migration uses the same ids, so re-running it updates in place). */
export function giftItemId(slug: string): string {
  return `gift_item_${slug}`;
}
export function giftProductId(sku: string): string {
  return `gift_product_${sku}`;
}
