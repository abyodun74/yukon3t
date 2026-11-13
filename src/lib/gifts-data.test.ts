import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIFT_CATALOG_SEED_MIGRATIONS,
  GIFT_ITEMS,
  GIFT_OCCASION_TAGS,
  GIFT_PRICE_CEILING_MINOR,
  GIFT_PRODUCTS,
  THANK_YOU_SKU,
  giftItemId,
  giftPieceNumber,
  giftProductId,
  type GiftItemDef,
  type GiftProductDef,
} from "@/lib/gifts-data";
import { isFreeGiftProduct } from "@/lib/gifts";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// The catalog in gifts-data.ts and the rows the seed migrations write must be the same list, and every item and box
// must have a name in every language.

const seeds = GIFT_CATALOG_SEED_MIGRATIONS.map((name) => ({
  name,
  sql: readFileSync(path.join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8"),
}));
const seed = seeds.map((s) => s.sql).join("\n");

// The canonical Phase A metadata statements (each item's and product's written by exactly one seed migration).
const sqlTags = (tags: readonly string[]) =>
  tags.length ? `ARRAY[${tags.map((t) => `'${t}'`).join(", ")}]::TEXT[]` : "ARRAY[]::TEXT[]";
const sqlText = (v: string | null | undefined) => (v == null ? "NULL" : `'${v}'`);
const itemMetaSql = (i: GiftItemDef) =>
  `UPDATE "GiftItem" SET "universe" = '${i.universe}'::"GiftUniverse", "collection" = '${i.collection}', "occasionTags" = ${sqlTags(i.occasionTags)}, "rarity" = '${i.rarity}'::"GiftRarity", "editionSize" = ${i.editionSize ?? "NULL"}, "availableFrom" = ${sqlText(i.availableFrom)}, "availableUntil" = ${sqlText(i.availableUntil)} WHERE "slug" = '${i.slug}';`;
const productMetaSql = (p: GiftProductDef) =>
  `UPDATE "GiftProduct" SET "universe" = '${p.universe}'::"GiftUniverse", "collection" = '${p.collection}', "occasionTags" = ${sqlTags(p.occasionTags)}, "rarity" = '${p.rarity}'::"GiftRarity", "availableFrom" = ${sqlText(p.availableFrom)}, "availableUntil" = ${sqlText(p.availableUntil)} WHERE "sku" = '${p.sku}';`;

describe("gift catalog", () => {
  it("has unique slugs and skus, and every product's items exist", () => {
    const slugs = GIFT_ITEMS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const skus = GIFT_PRODUCTS.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
    for (const product of GIFT_PRODUCTS) {
      expect(product.items.length, product.sku).toBeGreaterThan(0);
      for (const item of product.items) expect(slugs, product.sku).toContain(item.slug);
      if (!product.isBox) expect(product.items, product.sku).toHaveLength(1);
    }
  });

  it("matches the approved prices (USD store tiers, in cents)", () => {
    const price = Object.fromEntries(GIFT_PRODUCTS.map((p) => [p.sku, p.webPriceMinor]));
    for (const sku of ["sticker.wave", "sticker.heart-burst", "sticker.high-five", "sticker.coffee", "sticker.rose"]) {
      expect(price[sku], sku).toBe(99);
    }
    expect(price["badge.supporter-star"]).toBe(199);
    expect(price["badge.kindred-spirit"]).toBe(199);
    for (const sku of ["frame.aurora", "frame.frost", "frame.gold-ring"]) expect(price[sku], sku).toBe(299);
    expect(price["live.confetti"]).toBe(199);
    expect(price["live.aurora-sweep"]).toBe(499);
    expect(price["gift-luxury-red-rose"]).toBe(999);
    expect(price["box.say-hi"]).toBe(199);
    expect(price["box.celebration"]).toBe(499);
    expect(price["box.aurora"]).toBe(799);
    // Phase A sketch prices.
    expect(price["sticker.heartbeat-note"]).toBe(99);
    expect(price["box.love-letter"]).toBe(499);
    expect(price["box.party"]).toBe(499);
    expect(price["box.champion"]).toBe(799);
  });

  it("puts the approved contents in each box", () => {
    const box = (sku: string) => GIFT_PRODUCTS.find((p) => p.sku === sku)!.items.map((i) => i.slug).sort();
    expect(box("box.say-hi")).toEqual(["coffee", "high-five", "wave"]);
    expect(box("box.celebration")).toEqual(["confetti", "gold-ring-frame", "heart-burst", "rose"]);
    expect(box("box.aurora")).toEqual(["aurora-frame", "aurora-sweep", "supporter-star", "wave"]);
    expect(box("box.champion")).toEqual(["gg-badge", "level-up", "pixel-heart", "trophy-frame"]);
  });

  it("is seeded by the migrations, row for row, safely re-runnable", () => {
    for (const item of GIFT_ITEMS) {
      expect(seed, item.slug).toContain(
        `('${giftItemId(item.slug)}', '${item.slug}', '${item.kind}'::"GiftItemKind", '${item.assetKey}', true, ${item.sortOrder})`,
      );
    }
    for (const product of GIFT_PRODUCTS) {
      expect(seed, product.sku).toContain(
        `('${giftProductId(product.sku)}', '${product.sku}', ${product.isBox}, ${product.webPriceMinor}, 'USD', true, ${product.sortOrder})`,
      );
      for (const item of product.items) {
        expect(seed, `${product.sku}/${item.slug}`).toContain(`('gift_pi_${product.sku}_${item.slug}'`);
      }
    }
    // Upserts only: re-running updates in place and never duplicates or deletes. One upsert per table per migration
    // that inserts anything; a metadata-only migration has none (only UPDATEs by slug / sku).
    for (const { name, sql } of seeds) {
      const upserts = sql.match(/ON CONFLICT/g) ?? [];
      if (/INSERT INTO/.test(sql)) expect(upserts, name).toHaveLength(3);
      else expect(upserts, name).toHaveLength(0);
      expect(sql, name).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    }
  });

  it("seeds each item and product exactly once across the migrations", () => {
    const count = (needle: string) => seed.split(needle).length - 1;
    for (const item of GIFT_ITEMS) expect(count(`('${giftItemId(item.slug)}',`), item.slug).toBe(1);
    for (const product of GIFT_PRODUCTS) expect(count(`('${giftProductId(product.sku)}',`), product.sku).toBe(1);
  });

  it("writes every item's and product's Phase A metadata exactly once, as listed here", () => {
    const count = (needle: string) => seed.split(needle).length - 1;
    for (const item of GIFT_ITEMS) {
      expect(seed, item.slug).toContain(itemMetaSql(item));
      expect(count(`WHERE "slug" = '${item.slug}';`), item.slug).toBe(1);
    }
    for (const product of GIFT_PRODUCTS) {
      expect(seed, product.sku).toContain(productMetaSql(product));
      expect(count(`WHERE "sku" = '${product.sku}';`), product.sku).toBe(1);
    }
  });

  it("has sensible Phase A metadata: known tags, prices under the ceiling, free gifts are appreciation only", () => {
    for (const item of GIFT_ITEMS) {
      for (const tag of item.occasionTags) expect(GIFT_OCCASION_TAGS as readonly string[], item.slug).toContain(tag);
      if (item.rarity !== "EDITION") expect((item as GiftItemDef).editionSize ?? null, item.slug).toBeNull();
    }
    for (const product of GIFT_PRODUCTS) {
      expect(product.webPriceMinor, product.sku).toBeLessThanOrEqual(GIFT_PRICE_CEILING_MINOR);
      expect(product.webPriceMinor, product.sku).toBeGreaterThanOrEqual(0);
      if (product.webPriceMinor === 0) {
        expect(isFreeGiftProduct(product), product.sku).toBe(true);
        expect(product.sku.startsWith("free."), product.sku).toBe(true);
        expect(product.isBox, product.sku).toBe(false);
      }
    }
    expect(GIFT_PRODUCTS.find((p) => p.sku === THANK_YOU_SKU)?.webPriceMinor).toBe(0);
    expect(GIFT_PRICE_CEILING_MINOR).toBe(1999);
  });

  it("backfills the Phase 1 items sensibly (Red Rose and Aurora are Luxury)", () => {
    const universe = (slug: string) => GIFT_ITEMS.find((i) => i.slug === slug)!.universe;
    expect(universe("luxury-red-rose")).toBe("LUXURY");
    expect(universe("aurora-frame")).toBe("LUXURY");
    expect(universe("aurora-sweep")).toBe("LUXURY");
    expect(universe("rose")).toBe("LOVE");
    expect(universe("confetti")).toBe("CELEBRATE");
    expect(GIFT_PRODUCTS.find((p) => p.sku === "box.aurora")!.universe).toBe("LUXURY");
  });

  it("covers all five universes, and numbers the Luxury atelier pieces sequentially from the Red Rose", () => {
    expect(new Set(GIFT_ITEMS.map((i) => i.universe))).toEqual(new Set(["LOVE", "CELEBRATE", "GAMING", "LUXURY", "CULTURE"]));
    const pieces = GIFT_ITEMS.map((i) => giftPieceNumber(i.slug))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    expect(pieces).toEqual(pieces.map((_, i) => i + 1));
    expect(giftPieceNumber("luxury-red-rose")).toBe(1);
    expect(giftPieceNumber("wave")).toBeNull();
    expect(GIFT_ITEMS.find((i) => i.slug === "gold-orchid")?.rarity).toBe("EDITION");
  });

  it("lists the seed migrations oldest first, starting with the original seed", () => {
    expect([...GIFT_CATALOG_SEED_MIGRATIONS]).toEqual([...GIFT_CATALOG_SEED_MIGRATIONS].sort());
    expect(GIFT_CATALOG_SEED_MIGRATIONS[0]).toBe("20261112180300_gifts_catalog_seed");
  });

  it("has the Luxury Red Rose: a sticker sold alone as the most premium single gift", () => {
    expect(GIFT_ITEMS.find((i) => i.slug === "luxury-red-rose")).toMatchObject({
      slug: "luxury-red-rose",
      kind: "STICKER",
      assetKey: "luxury-red-rose",
      sortOrder: 130,
    });
    expect(GIFT_PRODUCTS.find((p) => p.sku === "gift-luxury-red-rose")).toMatchObject({
      sku: "gift-luxury-red-rose",
      isBox: false,
      webPriceMinor: 999,
      currency: "USD",
      sortOrder: 130,
      items: [{ slug: "luxury-red-rose", quantity: 1 }],
    });
    const singles = GIFT_PRODUCTS.filter((p) => !p.isBox);
    expect(Math.max(...singles.map((p) => p.webPriceMinor))).toBe(999);
    // 13 Phase 1 items + 15 Phase A gifts + 4 free kind words; 16 Phase 1 products + 19 singles + 4 boxes.
    expect(GIFT_ITEMS).toHaveLength(32);
    expect(GIFT_PRODUCTS).toHaveLength(39);
  });

  it.each(SUPPORTED_LOCALES)("names every item and box in %s", (locale) => {
    const t = DICTIONARIES[locale].gifts;
    expect(Object.keys(t.items).sort()).toEqual(GIFT_ITEMS.map((i) => i.slug).sort());
    expect(Object.keys(t.boxes).sort()).toEqual(
      GIFT_PRODUCTS.filter((p) => p.isBox)
        .map((p) => p.sku)
        .sort(),
    );
  });
});
