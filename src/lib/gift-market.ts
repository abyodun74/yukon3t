import { GIFT_CATEGORIES, GIFT_TIERS, type GiftCategoryName, type GiftTierName } from "@/lib/gifts-data";

// The gift marketplace: pure rules, unit-tested (gift-market.test.ts) and client-safe. The marketplace is a way to
// browse and send the existing Gift Universe catalog (src/lib/gifts-data.ts): its nine categories, four rarity tiers
// and Y3T Coin prices are columns on GiftProduct, and a send goes through the one existing path (createGiftIntent ->
// deliverGiftPurchase). Search, filters and sorting run here on the catalog the server sent; they decide only what is
// SHOWN. What a send costs is re-read and computed by the server, never taken from here.
//
// Honest wording (owner rules): a tier changes the look (glow, halo, particles), never what a gift gives; nothing says
// how many are left, how long something lasts, or who sent the most. "Immersive" is the effect filter's name for the
// Epic and Legendary treatments (layered light, particles, a slow sweep): it is a 2D web effect, not 3D.

export { GIFT_CATEGORIES, GIFT_TIERS };
export type { GiftCategoryName, GiftTierName };

export type MarketSort = "POPULAR" | "NEWEST" | "PRICE_LOW" | "PRICE_HIGH";
export type MarketAvailability = "ALL" | "ALWAYS" | "NUMBERED_OR_SEASONAL";
export type MarketEffect = "ALL" | "STANDARD" | "IMMERSIVE";

export const MARKET_SORTS: readonly MarketSort[] = ["POPULAR", "NEWEST", "PRICE_LOW", "PRICE_HIGH"];
export const MARKET_AVAILABILITIES: readonly MarketAvailability[] = ["ALL", "ALWAYS", "NUMBERED_OR_SEASONAL"];
export const MARKET_EFFECTS: readonly MarketEffect[] = ["ALL", "STANDARD", "IMMERSIVE"];

/** One marketplace gift as the browser gets it (getGiftMarketplace): no buyer, sender or count of anyone's sends. */
export type MarketGift = {
  sku: string;
  category: GiftCategoryName;
  tier: GiftTierName;
  coinPrice: number;
  featured: boolean;
  /** A numbered edition or a seasonal (yearly window) gift. */
  numberedOrSeasonal: boolean;
  /** Sendable right now (active, in season, copies left). A gift that isn't is shown, but Send is disabled. */
  available: boolean;
  /** Order among all gifts by how often each was given (0 = most). Never a count: used only to sort. */
  popularRank: number;
  /** Order by when it joined the catalog (higher = newer). */
  addedOrder: number;
  items: { slug: string; kind: "STICKER" | "FRAME" | "BADGE" | "LIVE_EFFECT"; assetKey: string }[];
};

export type MarketFilters = {
  categories: GiftCategoryName[];
  tiers: GiftTierName[];
  minPrice: number | null;
  maxPrice: number | null;
  availability: MarketAvailability;
  effect: MarketEffect;
  sort: MarketSort;
};

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  categories: [],
  tiers: [],
  minPrice: null,
  maxPrice: null,
  availability: "ALL",
  effect: "ALL",
  sort: "POPULAR",
};

export function isGiftCategory(value: unknown): value is GiftCategoryName {
  return typeof value === "string" && (GIFT_CATEGORIES as readonly string[]).includes(value);
}

export function isGiftTier(value: unknown): value is GiftTierName {
  return typeof value === "string" && (GIFT_TIERS as readonly string[]).includes(value);
}

/** The category's URL segment ("love-romance") and back. */
export function categorySlug(category: GiftCategoryName): string {
  return category.toLowerCase().replace(/_/g, "-");
}
export function categoryFromSlug(slug: string): GiftCategoryName | null {
  const value = slug.toUpperCase().replace(/-/g, "_");
  return isGiftCategory(value) ? value : null;
}

/** Epic and Legendary get the immersive treatment (layered light + particles); Common and Rare the standard one. */
export function effectOf(tier: GiftTierName): Exclude<MarketEffect, "ALL"> {
  return tier === "EPIC" || tier === "LEGENDARY" ? "IMMERSIVE" : "STANDARD";
}

/** Lower is rarer-last: COMMON 0 .. LEGENDARY 3. */
export function tierRank(tier: GiftTierName): number {
  return GIFT_TIERS.indexOf(tier);
}

/**
 * A price range from two typed inputs: whole, non-negative numbers or null (no bound); swapped if typed backwards.
 */
export function normalizePriceRange(min: unknown, max: unknown): { minPrice: number | null; maxPrice: number | null } {
  const clean = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };
  let minPrice = clean(min);
  let maxPrice = clean(max);
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];
  return { minPrice, maxPrice };
}

/** Case- and accent-insensitive text for search. */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

/** Whether a gift's localized name or description contains every word of the query. Empty query: everything. */
export function matchesSearch(query: string, texts: string[]): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldForSearch(texts.join(" "));
  return words.every((word) => haystack.includes(word));
}

/** How many filters differ from the defaults (sort excluded): the badge on the Filters button. */
export function activeFilterCount(filters: MarketFilters): number {
  let n = 0;
  if (filters.categories.length > 0) n++;
  if (filters.tiers.length > 0) n++;
  if (filters.minPrice !== null || filters.maxPrice !== null) n++;
  if (filters.availability !== "ALL") n++;
  if (filters.effect !== "ALL") n++;
  return n;
}

/** Whether a gift passes every filter (all combine: AND across groups, OR within a multi-select). */
export function passesFilters(gift: MarketGift, filters: MarketFilters): boolean {
  if (filters.categories.length > 0 && !filters.categories.includes(gift.category)) return false;
  if (filters.tiers.length > 0 && !filters.tiers.includes(gift.tier)) return false;
  if (filters.minPrice !== null && gift.coinPrice < filters.minPrice) return false;
  if (filters.maxPrice !== null && gift.coinPrice > filters.maxPrice) return false;
  if (filters.availability === "ALWAYS" && gift.numberedOrSeasonal) return false;
  if (filters.availability === "NUMBERED_OR_SEASONAL" && !gift.numberedOrSeasonal) return false;
  if (filters.effect !== "ALL" && effectOf(gift.tier) !== filters.effect) return false;
  return true;
}

/** Sorted copy. Ties fall back to the catalog's own order (addedOrder ascending), so the order is stable. */
export function sortMarketGifts(gifts: readonly MarketGift[], sort: MarketSort): MarketGift[] {
  const byCatalog = (a: MarketGift, b: MarketGift) => a.addedOrder - b.addedOrder;
  const compare: Record<MarketSort, (a: MarketGift, b: MarketGift) => number> = {
    POPULAR: (a, b) => a.popularRank - b.popularRank || byCatalog(a, b),
    NEWEST: (a, b) => b.addedOrder - a.addedOrder,
    PRICE_LOW: (a, b) => a.coinPrice - b.coinPrice || byCatalog(a, b),
    PRICE_HIGH: (a, b) => b.coinPrice - a.coinPrice || byCatalog(a, b),
  };
  return [...gifts].sort(compare[sort]);
}

/**
 * The grid: search (localized name + description, via `textsOf`), then every filter, then the sort, optionally only
 * favorites.
 */
export function applyMarket(
  gifts: readonly MarketGift[],
  input: {
    filters: MarketFilters;
    query: string;
    textsOf: (gift: MarketGift) => string[];
    favoritesOnly?: boolean;
    favorites?: ReadonlySet<string>;
  },
): MarketGift[] {
  const shown = gifts.filter(
    (gift) =>
      passesFilters(gift, input.filters) &&
      matchesSearch(input.query, input.textsOf(gift)) &&
      (!input.favoritesOnly || (input.favorites?.has(gift.sku) ?? false)),
  );
  return sortMarketGifts(shown, input.filters.sort);
}

/** Which empty state the grid shows, if any. */
export function marketEmptyState(input: {
  total: number;
  shown: number;
  query: string;
  filtersActive: boolean;
  favoritesOnly: boolean;
}): "empty_marketplace" | "no_search_results" | "no_filter_results" | "no_favorites" | null {
  if (input.total === 0) return "empty_marketplace";
  if (input.shown > 0) return null;
  if (input.query.trim()) return "no_search_results";
  if (input.filtersActive) return "no_filter_results";
  if (input.favoritesOnly) return "no_favorites";
  return "no_filter_results";
}

/** The lowest and highest coin price in a list (for the price inputs' hints), or null for an empty list. */
export function coinPriceBounds(gifts: readonly MarketGift[]): { min: number; max: number } | null {
  if (gifts.length === 0) return null;
  const prices = gifts.map((g) => g.coinPrice);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/**
 * Popularity ranks from per-sku delivered counts: the most-given gift gets 0. Ties share the catalog order. Counts never
 * leave the server; only these ranks do.
 */
export function popularRanks(skus: readonly string[], givenCount: ReadonlyMap<string, number>): Map<string, number> {
  const order = [...skus].map((sku, i) => ({ sku, i, n: givenCount.get(sku) ?? 0 }));
  order.sort((a, b) => b.n - a.n || a.i - b.i);
  return new Map(order.map((entry, rank) => [entry.sku, rank]));
}
