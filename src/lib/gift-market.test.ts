import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COIN_PRICE_MAX,
  GIFTS_PER_CATEGORY,
  GIFT_BOX_COIN_PRICES,
  GIFT_CATALOG_SEED_MIGRATIONS,
  GIFT_CATEGORIES,
  GIFT_ITEMS,
  GIFT_MARKET,
  GIFT_MARKET_SEED_MIGRATIONS,
  GIFT_PRODUCTS,
  GIFT_TIERS,
} from "@/lib/gifts-data";
import { isAwardProduct, isFreeGiftProduct } from "@/lib/gifts";
import { resolveGiftArt } from "@/lib/gift-assets";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import {
  DEFAULT_MARKET_FILTERS,
  activeFilterCount,
  applyMarket,
  categoryFromSlug,
  categorySlug,
  coinPriceBounds,
  effectOf,
  foldForSearch,
  marketEmptyState,
  matchesSearch,
  normalizePriceRange,
  passesFilters,
  popularRanks,
  sortMarketGifts,
  type MarketGift,
} from "@/lib/gift-market";

// The gift marketplace: the 36-gift launch catalog's invariants, its seed migration, and the pure search / filter /
// sort rules the marketplace screen runs.

const migrationSql = (name: string) => readFileSync(path.join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8");

describe("the marketplace launch catalog (GIFT_MARKET)", () => {
  const productBySku = new Map(GIFT_PRODUCTS.map((p) => [p.sku, p]));

  it("has exactly 36 gifts: 9 categories x 4, unique skus", () => {
    expect(GIFT_CATEGORIES).toHaveLength(9);
    expect(GIFT_MARKET).toHaveLength(36);
    expect(new Set(GIFT_MARKET.map((m) => m.sku)).size).toBe(36);
    for (const category of GIFT_CATEGORIES) {
      expect(GIFT_MARKET.filter((m) => m.category === category), category).toHaveLength(GIFTS_PER_CATEGORY);
    }
  });

  it("mixes rarities in every category, using only the four tiers", () => {
    for (const m of GIFT_MARKET) expect(GIFT_TIERS as readonly string[], m.sku).toContain(m.tier);
    for (const category of GIFT_CATEGORIES) {
      const tiers = new Set(GIFT_MARKET.filter((m) => m.category === category).map((m) => m.tier));
      expect(tiers.size, category).toBeGreaterThanOrEqual(3);
    }
    for (const tier of GIFT_TIERS) expect(GIFT_MARKET.some((m) => m.tier === tier), tier).toBe(true);
  });

  it("is made of real, paid single gifts (never a free kind word, an award or a box), each with art and a price", () => {
    for (const m of GIFT_MARKET) {
      const product = productBySku.get(m.sku);
      expect(product, m.sku).toBeDefined();
      expect(product!.isBox, m.sku).toBe(false);
      expect(product!.webPriceMinor, m.sku).toBeGreaterThan(0);
      expect(isFreeGiftProduct(product!) || isAwardProduct(product!), m.sku).toBe(false);
      expect(Number.isInteger(m.coinPrice) && m.coinPrice >= 1 && m.coinPrice <= COIN_PRICE_MAX, m.sku).toBe(true);
      for (const { slug } of product!.items) {
        const item = GIFT_ITEMS.find((i) => i.slug === slug)!;
        const art = resolveGiftArt(item.assetKey);
        // Drawn art for its own key, or its raster picture: never the sparkle fallback.
        if (art.type === "svg") expect(art.key, slug).toBe(item.assetKey);
      }
    }
  });

  it("maps every existing paid single gift into a category (merged, not duplicated)", () => {
    const paidSingles = GIFT_PRODUCTS.filter((p) => !p.isBox && p.webPriceMinor > 0).map((p) => p.sku);
    expect(GIFT_MARKET.map((m) => m.sku).sort()).toEqual([...paidSingles].sort());
  });

  it("prices tiers in order inside each category (a rarer gift never costs less)", () => {
    const rank = (t: string) => GIFT_TIERS.indexOf(t as (typeof GIFT_TIERS)[number]);
    for (const category of GIFT_CATEGORIES) {
      const rows = GIFT_MARKET.filter((m) => m.category === category).sort((a, b) => rank(a.tier) - rank(b.tier) || a.coinPrice - b.coinPrice);
      for (let i = 1; i < rows.length; i++) expect(rows[i].coinPrice, `${category} ${rows[i].sku}`).toBeGreaterThanOrEqual(rows[i - 1].coinPrice);
    }
  });

  it("gives every box a coin price, and nothing free or awarded one", () => {
    for (const p of GIFT_PRODUCTS.filter((p) => p.isBox)) expect(GIFT_BOX_COIN_PRICES[p.sku], p.sku).toBeGreaterThan(0);
    const priced = new Set([...GIFT_MARKET.map((m) => m.sku), ...Object.keys(GIFT_BOX_COIN_PRICES)]);
    for (const p of GIFT_PRODUCTS.filter((p) => p.webPriceMinor === 0)) expect(priced.has(p.sku), p.sku).toBe(false);
  });

  it.each(SUPPORTED_LOCALES)("names every category, tier and marketplace word in %s", (locale) => {
    const m = DICTIONARIES[locale].gifts.market;
    for (const category of GIFT_CATEGORIES) expect(m.categories[category].length, category).toBeGreaterThan(0);
    for (const tier of GIFT_TIERS) expect(m.tiers[tier].length, tier).toBeGreaterThan(0);
    // Coins are granted, never bought: no wording anywhere suggests buying them.
    expect(m.grantedNote.length).toBeGreaterThan(0);
  });

  it("never offers a way to buy coins in English (no buy / purchase / top up wording)", () => {
    const m = DICTIONARIES.en.gifts.market;
    const all = JSON.stringify(m);
    expect(all).not.toMatch(/\b(buy coins|purchase coins|top up|add coins|get more coins)\b/i);
    expect(m.grantedNote).toMatch(/can't be bought/);
  });
});

describe("the marketplace seed migration", () => {
  const seed = migrationSql(GIFT_MARKET_SEED_MIGRATIONS[0]);
  const ddl = migrationSql("20261201120200_gift_marketplace_coins");

  it("is a catalog seed migration too (it inserts the eight new gifts), listed after every earlier one", () => {
    expect(GIFT_CATALOG_SEED_MIGRATIONS.at(-1)).toBe(GIFT_MARKET_SEED_MIGRATIONS[0]);
  });

  it("writes each launch gift's coin price, category, tier and featured flag exactly once, as listed", () => {
    for (const m of GIFT_MARKET) {
      const line = `UPDATE "GiftProduct" SET "coinPrice" = ${m.coinPrice}, "category" = '${m.category}'::"GiftCategory", "tier" = '${m.tier}'::"GiftTier", "featured" = ${m.featured} WHERE "GiftProduct"."sku" = '${m.sku}';`;
      expect(seed, m.sku).toContain(line);
      expect(seed.split(`WHERE "GiftProduct"."sku" = '${m.sku}';`).length - 1, m.sku).toBe(1);
    }
    for (const [sku, price] of Object.entries(GIFT_BOX_COIN_PRICES)) {
      expect(seed, sku).toContain(
        `UPDATE "GiftProduct" SET "coinPrice" = ${price}, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = '${sku}';`,
      );
    }
  });

  it("only adds and fills: no delete, drop, truncate, rename or deactivation of anything that exists", () => {
    for (const [name, sql] of [
      ["seed", seed],
      ["ddl", ddl],
    ] as const) {
      // Statements only (comments stripped); a foreign key's ON DELETE rule is not a delete.
      const statements = sql.replace(/--[^\n]*/g, "").replace(/ON DELETE (CASCADE|SET NULL|RESTRICT)/g, "");
      expect(statements, name).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|\bRENAME\b/i);
      expect(statements, name).not.toMatch(/"active"\s*=\s*false/i);
    }
    // Every UPDATE targets one product by sku or one item by slug (never a bulk update of existing rows).
    for (const line of seed.split("\n").filter((l) => l.startsWith("UPDATE"))) {
      expect(line).toMatch(/WHERE ("GiftProduct"\.)?"(sku|slug)" = '[a-z0-9.-]+';$/);
    }
  });

  it("creates its schema idempotently and doesn't use an enum value it relies on in the same migration", () => {
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS "CoinWallet"/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS "CoinLedgerEntry"/);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS "GiftFavorite"/);
    expect(ddl).toMatch(/ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1/);
    // The new enum values each come from a migration of their own, before this one.
    expect(ddl).not.toMatch(/'COINS'|'COINS_GRANTED'|ADD VALUE/);
    expect(migrationSql("20261201120000_gift_purchase_provider_coins").trim()).toMatch(/ALTER TYPE "GiftPurchaseProvider" ADD VALUE IF NOT EXISTS 'COINS';$/);
    expect(migrationSql("20261201120100_coins_granted_audit_action").trim()).toMatch(/ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COINS_GRANTED';$/);
    // The ledger is append-only, and a wallet can't go below zero.
    expect(ddl).toMatch(/BEFORE UPDATE ON "CoinLedgerEntry"/);
    expect(ddl).toMatch(/CHECK \("balance" >= 0\)/);
  });
});

const gift = (sku: string, over: Partial<MarketGift> = {}): MarketGift => ({
  sku,
  category: "LOVE_ROMANCE",
  tier: "COMMON",
  coinPrice: 25,
  featured: false,
  numberedOrSeasonal: false,
  available: true,
  popularRank: 0,
  addedOrder: 0,
  items: [{ slug: sku, kind: "STICKER", assetKey: sku }],
  ...over,
});

const catalog = [
  gift("rose", { coinPrice: 25, popularRank: 2, addedOrder: 10 }),
  gift("orchid", { category: "LUXURY", tier: "LEGENDARY", coinPrice: 900, numberedOrSeasonal: true, popularRank: 0, addedOrder: 20 }),
  gift("trophy", { category: "GAMING", tier: "EPIC", coinPrice: 250, popularRank: 1, addedOrder: 30 }),
  gift("bear", { category: "CUTE_FUN", tier: "RARE", coinPrice: 90, popularRank: 3, addedOrder: 40 }),
];

describe("marketplace filters, search and sort", () => {
  const texts = (g: MarketGift) => [g.sku === "bear" ? "Osito de peluche" : g.sku];

  it("combines every filter (AND across groups, OR inside a multi-select)", () => {
    const f = { ...DEFAULT_MARKET_FILTERS, categories: ["LUXURY", "GAMING"] as MarketGift["category"][] };
    expect(catalog.filter((g) => passesFilters(g, f)).map((g) => g.sku)).toEqual(["orchid", "trophy"]);
    const g2 = { ...f, tiers: ["EPIC"] as MarketGift["tier"][] };
    expect(catalog.filter((g) => passesFilters(g, g2)).map((g) => g.sku)).toEqual(["trophy"]);
    expect(catalog.filter((g) => passesFilters(g, { ...DEFAULT_MARKET_FILTERS, minPrice: 50, maxPrice: 300 })).map((g) => g.sku)).toEqual([
      "trophy",
      "bear",
    ]);
    expect(catalog.filter((g) => passesFilters(g, { ...DEFAULT_MARKET_FILTERS, availability: "NUMBERED_OR_SEASONAL" })).map((g) => g.sku)).toEqual([
      "orchid",
    ]);
    expect(catalog.filter((g) => passesFilters(g, { ...DEFAULT_MARKET_FILTERS, availability: "ALWAYS" }))).toHaveLength(3);
    expect(catalog.filter((g) => passesFilters(g, { ...DEFAULT_MARKET_FILTERS, effect: "IMMERSIVE" })).map((g) => g.sku)).toEqual([
      "orchid",
      "trophy",
    ]);
    expect(catalog.filter((g) => passesFilters(g, { ...DEFAULT_MARKET_FILTERS, effect: "STANDARD" })).map((g) => g.sku)).toEqual(["rose", "bear"]);
  });

  it("sorts popular, newest, lowest and highest price, stably", () => {
    expect(sortMarketGifts(catalog, "POPULAR").map((g) => g.sku)).toEqual(["orchid", "trophy", "rose", "bear"]);
    expect(sortMarketGifts(catalog, "NEWEST").map((g) => g.sku)).toEqual(["bear", "trophy", "orchid", "rose"]);
    expect(sortMarketGifts(catalog, "PRICE_LOW").map((g) => g.sku)).toEqual(["rose", "bear", "trophy", "orchid"]);
    expect(sortMarketGifts(catalog, "PRICE_HIGH").map((g) => g.sku)).toEqual(["orchid", "trophy", "bear", "rose"]);
    const tie = [gift("b", { coinPrice: 10, addedOrder: 2 }), gift("a", { coinPrice: 10, addedOrder: 1 })];
    expect(sortMarketGifts(tie, "PRICE_LOW").map((g) => g.sku)).toEqual(["a", "b"]);
    // Never sorts in place.
    expect(catalog.map((g) => g.sku)).toEqual(["rose", "orchid", "trophy", "bear"]);
  });

  it("searches localized names, accent- and case-insensitively, every word", () => {
    expect(foldForSearch("  Ósito ")).toBe("osito");
    expect(matchesSearch("osito", ["Osito de peluche"])).toBe(true);
    expect(matchesSearch("PELUCHE osito", ["Osito de peluche"])).toBe(true);
    expect(matchesSearch("osito gato", ["Osito de peluche"])).toBe(false);
    expect(matchesSearch("   ", ["anything"])).toBe(true);
    expect(applyMarket(catalog, { filters: DEFAULT_MARKET_FILTERS, query: "ósito", textsOf: texts }).map((g) => g.sku)).toEqual(["bear"]);
  });

  it("filters to favorites only when asked", () => {
    const favorites = new Set(["rose", "trophy"]);
    expect(
      applyMarket(catalog, { filters: DEFAULT_MARKET_FILTERS, query: "", textsOf: texts, favoritesOnly: true, favorites }).map((g) => g.sku),
    ).toEqual(["trophy", "rose"]);
  });

  it("cleans a typed price range (negative, junk, backwards)", () => {
    expect(normalizePriceRange("", "")).toEqual({ minPrice: null, maxPrice: null });
    expect(normalizePriceRange("300", "50")).toEqual({ minPrice: 50, maxPrice: 300 });
    expect(normalizePriceRange("-5", "abc")).toEqual({ minPrice: null, maxPrice: null });
    expect(normalizePriceRange("12.7", 40)).toEqual({ minPrice: 12, maxPrice: 40 });
  });

  it("counts active filters (sort excluded) and picks the right empty state", () => {
    expect(activeFilterCount(DEFAULT_MARKET_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_MARKET_FILTERS, sort: "NEWEST" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_MARKET_FILTERS, tiers: ["RARE"], minPrice: 1, effect: "IMMERSIVE" })).toBe(3);
    const base = { total: 4, shown: 0, query: "", filtersActive: false, favoritesOnly: false };
    expect(marketEmptyState({ ...base, total: 0 })).toBe("empty_marketplace");
    expect(marketEmptyState({ ...base, shown: 2 })).toBeNull();
    expect(marketEmptyState({ ...base, query: "zzz" })).toBe("no_search_results");
    expect(marketEmptyState({ ...base, filtersActive: true })).toBe("no_filter_results");
    expect(marketEmptyState({ ...base, favoritesOnly: true })).toBe("no_favorites");
  });

  it("maps tiers to effects, categories to URL slugs and back, and finds price bounds", () => {
    expect(effectOf("COMMON")).toBe("STANDARD");
    expect(effectOf("RARE")).toBe("STANDARD");
    expect(effectOf("EPIC")).toBe("IMMERSIVE");
    expect(effectOf("LEGENDARY")).toBe("IMMERSIVE");
    for (const category of GIFT_CATEGORIES) expect(categoryFromSlug(categorySlug(category))).toBe(category);
    expect(categorySlug("SPECIAL_MOMENTS")).toBe("special-moments");
    expect(categoryFromSlug("nope")).toBeNull();
    expect(categoryFromSlug("__proto__")).toBeNull();
    expect(coinPriceBounds(catalog)).toEqual({ min: 25, max: 900 });
    expect(coinPriceBounds([])).toBeNull();
  });

  it("turns delivered counts into a popularity order (most given first; ties keep the catalog order), never a count", () => {
    const ranks = popularRanks(["a", "b", "c"], new Map([["c", 9], ["a", 2]]));
    expect([...ranks.entries()]).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });
});
