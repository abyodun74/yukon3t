// The digital-gift catalog (src/lib/gifts.ts), as data. Pure and client-safe. The database rows are seeded from
// exactly this by the catalog seed migrations (GIFT_CATALOG_SEED_MIGRATIONS; gifts-data.test.ts checks that together
// they name every item, product and box content listed here, and that every item's and product's Phase A metadata is
// written by exactly one metadata UPDATE), and the actions read the database, never this file, for what can be sent:
// a product an admin switches off (GiftProduct.active) can't be sent whatever this says.
//
// Prices are the store price tiers in USD, in minor units (cents), as GiftProduct.webPriceMinor; never above
// GIFT_PRICE_CEILING_MINOR. A price of 0 is a free gift (only the appreciation sentiments; sent by sendFreeGift, never
// by createGiftIntent). Store product ids (GiftProduct.appleProductId / googleProductId) are set in the payments
// phases, once the products exist in App Store Connect and the Play Console.
//
// Phase A metadata: `universe` (the picker section, src/lib/gift-universes.ts), `collection` (a slug grouping items
// inside a universe), `occasionTags` (what occasions the gift fits, matched by src/lib/gift-occasions.ts), `rarity`
// (EDITION items are numbered 1, 2, 3... at delivery), `editionSize` (EDITION only; null = an open edition), and a
// yearly `availableFrom`/`availableUntil` window as "MM-DD" (null = always; a seasonal gift comes back every year).
// `piece` is display-only: a Luxury "atelier" item's place in that collection (the Luxury Red Rose is piece No. 1).
//
// Names and descriptions are in the `gifts` dictionary (src/lib/i18n/<lang>/gifts.ts) under `items.<slug>` and
// `boxes.<sku>`, in every language. Art is resolved from `assetKey` by src/lib/gift-assets.ts (an SVG drawn by
// src/components/gift-art.tsx, a raster picture in public/gifts/, and optionally a Lottie animation in
// public/gifts/lottie/).

/**
 * The migrations that seed this catalog, oldest first. Applied migrations are never edited: a new gift gets a new seed
 * migration, added here.
 */
export const GIFT_CATALOG_SEED_MIGRATIONS = [
  "20261112180300_gifts_catalog_seed",
  "20261113120000_gift_luxury_red_rose",
  "20261114120200_gift_catalog_metadata",
  "20261114120300_gift_universe_catalog_seed",
] as const;

/** No gift, box or edition costs more than this (USD cents). */
export const GIFT_PRICE_CEILING_MINOR = 1999;

export type GiftItemKindName = "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT";
export type GiftUniverseName = "LOVE" | "CELEBRATE" | "GAMING" | "LUXURY" | "CULTURE";
export type GiftRarityName = "STANDARD" | "PREMIUM" | "EDITION";

/** Every occasion tag a gift may carry. */
export const GIFT_OCCASION_TAGS = [
  "birthday",
  "love",
  "appreciation",
  "graduation",
  "achievement",
  "holiday",
  "anniversary",
  "tournament_win",
  "community",
] as const;
export type GiftOccasionTag = (typeof GIFT_OCCASION_TAGS)[number];

type GiftMeta = {
  universe: GiftUniverseName;
  collection: string;
  occasionTags: readonly GiftOccasionTag[];
  rarity: GiftRarityName;
  availableFrom?: string | null;
  availableUntil?: string | null;
};

export type GiftItemDef = GiftMeta & {
  slug: string;
  kind: GiftItemKindName;
  assetKey: string;
  sortOrder: number;
  editionSize?: number | null;
  piece?: number;
};
export type GiftProductDef = GiftMeta & {
  sku: string;
  isBox: boolean;
  webPriceMinor: number;
  currency: "USD";
  sortOrder: number;
  items: { slug: string; quantity: number }[];
};

export const GIFT_ITEMS = [
  // Phase 1 classics (metadata backfilled by 20261114120200_gift_catalog_metadata).
  { slug: "wave", kind: "STICKER", assetKey: "wave", sortOrder: 10, universe: "CELEBRATE", collection: "classics", occasionTags: ["appreciation"], rarity: "STANDARD" },
  { slug: "heart-burst", kind: "STICKER", assetKey: "heart-burst", sortOrder: 20, universe: "LOVE", collection: "classics", occasionTags: ["love", "birthday"], rarity: "STANDARD" },
  { slug: "high-five", kind: "STICKER", assetKey: "high-five", sortOrder: 30, universe: "CELEBRATE", collection: "classics", occasionTags: ["achievement", "appreciation"], rarity: "STANDARD" },
  { slug: "coffee", kind: "STICKER", assetKey: "coffee", sortOrder: 40, universe: "CULTURE", collection: "gatherings", occasionTags: ["appreciation", "community"], rarity: "STANDARD" },
  { slug: "rose", kind: "STICKER", assetKey: "rose", sortOrder: 50, universe: "LOVE", collection: "classics", occasionTags: ["love", "anniversary"], rarity: "STANDARD" },
  { slug: "supporter-star", kind: "BADGE", assetKey: "supporter-star", sortOrder: 60, universe: "CELEBRATE", collection: "classics", occasionTags: ["achievement", "appreciation"], rarity: "STANDARD" },
  { slug: "kindred-spirit", kind: "BADGE", assetKey: "kindred-spirit", sortOrder: 70, universe: "LOVE", collection: "classics", occasionTags: ["love", "anniversary"], rarity: "STANDARD" },
  { slug: "aurora-frame", kind: "FRAME", assetKey: "aurora-frame", sortOrder: 80, universe: "LUXURY", collection: "aurora", occasionTags: ["anniversary", "achievement"], rarity: "PREMIUM" },
  { slug: "frost-frame", kind: "FRAME", assetKey: "frost-frame", sortOrder: 90, universe: "CELEBRATE", collection: "classics", occasionTags: ["birthday"], rarity: "STANDARD" },
  { slug: "gold-ring-frame", kind: "FRAME", assetKey: "gold-ring-frame", sortOrder: 100, universe: "LUXURY", collection: "atelier", occasionTags: ["anniversary", "love"], rarity: "PREMIUM", piece: 4 },
  { slug: "confetti", kind: "LIVE_EFFECT", assetKey: "confetti", sortOrder: 110, universe: "CELEBRATE", collection: "party", occasionTags: ["birthday", "achievement", "graduation"], rarity: "STANDARD" },
  { slug: "aurora-sweep", kind: "LIVE_EFFECT", assetKey: "aurora-sweep", sortOrder: 120, universe: "LUXURY", collection: "aurora", occasionTags: ["achievement", "anniversary"], rarity: "PREMIUM" },
  // Raster art (public/gifts/luxury-red-rose*.webp); the most premium single gift, piece No. 1 of the Luxury atelier.
  { slug: "luxury-red-rose", kind: "STICKER", assetKey: "luxury-red-rose", sortOrder: 130, universe: "LUXURY", collection: "atelier", occasionTags: ["love", "anniversary", "birthday"], rarity: "PREMIUM", piece: 1 },

  // Phase A (20261114120300_gift_universe_catalog_seed). Love & Emotion: soft lines, mostly private 1:1.
  { slug: "heartbeat-note", kind: "STICKER", assetKey: "heartbeat-note", sortOrder: 140, universe: "LOVE", collection: "tender", occasionTags: ["love", "appreciation"], rarity: "STANDARD" },
  { slug: "paper-crane", kind: "STICKER", assetKey: "paper-crane", sortOrder: 150, universe: "LOVE", collection: "tender", occasionTags: ["love", "appreciation"], rarity: "STANDARD" },
  { slug: "forget-me-not", kind: "STICKER", assetKey: "forget-me-not", sortOrder: 160, universe: "LOVE", collection: "tender", occasionTags: ["love", "anniversary"], rarity: "STANDARD" },
  // Celebrate & Inspire.
  { slug: "birthday-candle", kind: "STICKER", assetKey: "birthday-candle", sortOrder: 170, universe: "CELEBRATE", collection: "party", occasionTags: ["birthday"], rarity: "STANDARD" },
  { slug: "cake-slice", kind: "STICKER", assetKey: "cake-slice", sortOrder: 180, universe: "CELEBRATE", collection: "party", occasionTags: ["birthday", "anniversary"], rarity: "STANDARD" },
  { slug: "grad-cap", kind: "STICKER", assetKey: "grad-cap", sortOrder: 190, universe: "CELEBRATE", collection: "milestones", occasionTags: ["graduation", "achievement"], rarity: "STANDARD" },
  { slug: "gold-star", kind: "STICKER", assetKey: "gold-star", sortOrder: 200, universe: "CELEBRATE", collection: "milestones", occasionTags: ["achievement", "graduation", "appreciation"], rarity: "STANDARD" },
  // Gaming Arena (an ordinary shelf in this phase: no occasion promotes it yet).
  { slug: "gg-badge", kind: "BADGE", assetKey: "gg-badge", sortOrder: 210, universe: "GAMING", collection: "arena", occasionTags: ["tournament_win", "achievement"], rarity: "STANDARD" },
  { slug: "level-up", kind: "LIVE_EFFECT", assetKey: "level-up", sortOrder: 220, universe: "GAMING", collection: "arena", occasionTags: ["tournament_win", "achievement"], rarity: "STANDARD" },
  { slug: "trophy-frame", kind: "FRAME", assetKey: "trophy-frame", sortOrder: 230, universe: "GAMING", collection: "arena", occasionTags: ["tournament_win", "achievement"], rarity: "STANDARD" },
  { slug: "pixel-heart", kind: "STICKER", assetKey: "pixel-heart", sortOrder: 240, universe: "GAMING", collection: "arena", occasionTags: ["appreciation"], rarity: "STANDARD" },
  // Luxury Universe: black and gold, slow reveals. The Gold Orchid is an open numbered edition.
  { slug: "gold-orchid", kind: "STICKER", assetKey: "gold-orchid", sortOrder: 250, universe: "LUXURY", collection: "atelier", occasionTags: ["love", "anniversary", "achievement"], rarity: "EDITION", editionSize: null, piece: 2 },
  { slug: "midnight-crystal-frame", kind: "FRAME", assetKey: "midnight-crystal-frame", sortOrder: 260, universe: "LUXURY", collection: "atelier", occasionTags: ["anniversary", "birthday"], rarity: "PREMIUM", piece: 3 },
  // Culture & Community: neutral, no religious iconography.
  { slug: "lantern", kind: "STICKER", assetKey: "lantern", sortOrder: 270, universe: "CULTURE", collection: "gatherings", occasionTags: ["holiday", "community"], rarity: "STANDARD" },
  { slug: "shared-table", kind: "STICKER", assetKey: "shared-table", sortOrder: 280, universe: "CULTURE", collection: "gatherings", occasionTags: ["holiday", "community", "appreciation"], rarity: "STANDARD" },
  // Free "kind words" (price 0, sendFreeGift).
  { slug: "thank-you", kind: "STICKER", assetKey: "thank-you", sortOrder: 300, universe: "LOVE", collection: "kind-words", occasionTags: ["appreciation"], rarity: "STANDARD" },
  { slug: "appreciate-you", kind: "STICKER", assetKey: "appreciate-you", sortOrder: 310, universe: "LOVE", collection: "kind-words", occasionTags: ["appreciation"], rarity: "STANDARD" },
  { slug: "cheering-you-on", kind: "STICKER", assetKey: "cheering-you-on", sortOrder: 320, universe: "CELEBRATE", collection: "kind-words", occasionTags: ["appreciation"], rarity: "STANDARD" },
  { slug: "proud-of-you", kind: "STICKER", assetKey: "proud-of-you", sortOrder: 330, universe: "CELEBRATE", collection: "kind-words", occasionTags: ["appreciation"], rarity: "STANDARD" },
] as const satisfies readonly GiftItemDef[];

export type GiftItemSlug = (typeof GIFT_ITEMS)[number]["slug"];

const itemBySlug = new Map<string, GiftItemDef>(GIFT_ITEMS.map((item) => [item.slug, item]));

/** A single gift: the product takes its item's metadata. */
const single = (sku: string, slug: GiftItemSlug, webPriceMinor: number, sortOrder: number): GiftProductDef => {
  const item = itemBySlug.get(slug)!;
  return {
    sku,
    isBox: false,
    webPriceMinor,
    currency: "USD",
    sortOrder,
    items: [{ slug, quantity: 1 }],
    universe: item.universe,
    collection: item.collection,
    occasionTags: item.occasionTags,
    rarity: item.rarity,
  };
};

const box = (
  sku: string,
  webPriceMinor: number,
  sortOrder: number,
  meta: GiftMeta,
  slugs: GiftItemSlug[],
): GiftProductDef => ({
  sku,
  isBox: true,
  webPriceMinor,
  currency: "USD",
  sortOrder,
  items: slugs.map((slug) => ({ slug, quantity: 1 })),
  ...meta,
});

export const GIFT_PRODUCTS: readonly GiftProductDef[] = [
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
  single("gift-luxury-red-rose", "luxury-red-rose", 999, 130),
  box("box.say-hi", 199, 200, { universe: "CELEBRATE", collection: "classics", occasionTags: ["appreciation"], rarity: "STANDARD" }, [
    "wave",
    "high-five",
    "coffee",
  ]),
  box(
    "box.celebration",
    499,
    210,
    { universe: "CELEBRATE", collection: "party", occasionTags: ["birthday", "achievement", "anniversary"], rarity: "STANDARD" },
    ["heart-burst", "rose", "confetti", "gold-ring-frame"],
  ),
  box("box.aurora", 799, 220, { universe: "LUXURY", collection: "aurora", occasionTags: ["achievement", "anniversary"], rarity: "PREMIUM" }, [
    "aurora-frame",
    "aurora-sweep",
    "supporter-star",
    "wave",
  ]),

  // Phase A.
  single("sticker.heartbeat-note", "heartbeat-note", 99, 140),
  single("sticker.paper-crane", "paper-crane", 99, 150),
  single("sticker.forget-me-not", "forget-me-not", 99, 160),
  single("sticker.birthday-candle", "birthday-candle", 99, 170),
  single("sticker.cake-slice", "cake-slice", 99, 180),
  single("sticker.grad-cap", "grad-cap", 199, 190),
  single("sticker.gold-star", "gold-star", 99, 200),
  single("badge.gg", "gg-badge", 199, 210),
  single("live.level-up", "level-up", 199, 220),
  single("frame.trophy", "trophy-frame", 299, 230),
  single("sticker.pixel-heart", "pixel-heart", 99, 240),
  single("sticker.gold-orchid", "gold-orchid", 499, 250),
  single("frame.midnight-crystal", "midnight-crystal-frame", 499, 260),
  single("sticker.lantern", "lantern", 99, 270),
  single("sticker.shared-table", "shared-table", 199, 280),
  box("box.love-letter", 499, 400, { universe: "LOVE", collection: "tender", occasionTags: ["love", "anniversary"], rarity: "STANDARD" }, [
    "heartbeat-note",
    "paper-crane",
    "forget-me-not",
  ]),
  box("box.party", 499, 410, { universe: "CELEBRATE", collection: "party", occasionTags: ["birthday"], rarity: "STANDARD" }, [
    "birthday-candle",
    "cake-slice",
    "confetti",
  ]),
  box(
    "box.champion",
    799,
    420,
    { universe: "GAMING", collection: "arena", occasionTags: ["tournament_win", "achievement"], rarity: "STANDARD" },
    ["gg-badge", "level-up", "trophy-frame", "pixel-heart"],
  ),
  box("box.harvest", 499, 430, { universe: "CULTURE", collection: "gatherings", occasionTags: ["holiday", "community"], rarity: "STANDARD" }, [
    "lantern",
    "shared-table",
    "coffee",
  ]),
  // Free kind words: price 0, appreciation only.
  single("free.thank-you", "thank-you", 0, 500),
  single("free.appreciate-you", "appreciate-you", 0, 510),
  single("free.cheering-you-on", "cheering-you-on", 0, 520),
  single("free.proud-of-you", "proud-of-you", 0, 530),
];

/** The free product a recipient sends back to thank someone for a gift (sendThankYouGift). */
export const THANK_YOU_SKU = "free.thank-you";

/** The fixed database id of a catalog row (the seed migration uses the same ids, so re-running it updates in place). */
export function giftItemId(slug: string): string {
  return `gift_item_${slug}`;
}
export function giftProductId(sku: string): string {
  return `gift_product_${sku}`;
}

/** A Luxury atelier piece number for display ("Piece No. 1"), or null. Sequential by design, never random. */
export function giftPieceNumber(slug: string): number | null {
  return itemBySlug.get(slug)?.piece ?? null;
}
