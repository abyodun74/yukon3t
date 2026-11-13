import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIFT_ITEMS, GIFT_PRODUCTS, giftItemId, giftProductId } from "@/lib/gifts-data";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// The catalog in gifts-data.ts and the rows the seed migration writes must be the same list, and every item and box
// must have a name in every language.

const seed = readFileSync(
  path.join(process.cwd(), "prisma/migrations/20261112180300_gifts_catalog_seed/migration.sql"),
  "utf8",
);

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
    expect(price["box.say-hi"]).toBe(199);
    expect(price["box.celebration"]).toBe(499);
    expect(price["box.aurora"]).toBe(799);
  });

  it("puts the approved contents in each box", () => {
    const box = (sku: string) => GIFT_PRODUCTS.find((p) => p.sku === sku)!.items.map((i) => i.slug).sort();
    expect(box("box.say-hi")).toEqual(["coffee", "high-five", "wave"]);
    expect(box("box.celebration")).toEqual(["confetti", "gold-ring-frame", "heart-burst", "rose"]);
    expect(box("box.aurora")).toEqual(["aurora-frame", "aurora-sweep", "supporter-star", "wave"]);
  });

  it("is seeded by the migration, row for row, safely re-runnable", () => {
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
    // Upserts only: re-running updates in place and never duplicates or deletes.
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(3);
    expect(seed).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
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
