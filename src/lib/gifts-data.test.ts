import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIFT_CATALOG_SEED_MIGRATIONS, GIFT_ITEMS, GIFT_PRODUCTS, giftItemId, giftProductId } from "@/lib/gifts-data";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// The catalog in gifts-data.ts and the rows the seed migrations write must be the same list, and every item and box
// must have a name in every language.

const seeds = GIFT_CATALOG_SEED_MIGRATIONS.map((name) => ({
  name,
  sql: readFileSync(path.join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8"),
}));
const seed = seeds.map((s) => s.sql).join("\n");

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
  });

  it("puts the approved contents in each box", () => {
    const box = (sku: string) => GIFT_PRODUCTS.find((p) => p.sku === sku)!.items.map((i) => i.slug).sort();
    expect(box("box.say-hi")).toEqual(["coffee", "high-five", "wave"]);
    expect(box("box.celebration")).toEqual(["confetti", "gold-ring-frame", "heart-burst", "rose"]);
    expect(box("box.aurora")).toEqual(["aurora-frame", "aurora-sweep", "supporter-star", "wave"]);
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
    // Upserts only: re-running updates in place and never duplicates or deletes. One upsert per table per migration.
    for (const { name, sql } of seeds) {
      expect(sql.match(/ON CONFLICT/g), name).toHaveLength(3);
      expect(sql, name).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    }
  });

  it("seeds each item and product exactly once across the migrations", () => {
    const count = (needle: string) => seed.split(needle).length - 1;
    for (const item of GIFT_ITEMS) expect(count(`('${giftItemId(item.slug)}',`), item.slug).toBe(1);
    for (const product of GIFT_PRODUCTS) expect(count(`('${giftProductId(product.sku)}',`), product.sku).toBe(1);
  });

  it("lists the seed migrations oldest first, starting with the original seed", () => {
    expect([...GIFT_CATALOG_SEED_MIGRATIONS]).toEqual([...GIFT_CATALOG_SEED_MIGRATIONS].sort());
    expect(GIFT_CATALOG_SEED_MIGRATIONS[0]).toBe("20261112180300_gifts_catalog_seed");
  });

  it("has the Luxury Red Rose: a sticker sold alone as the most premium single gift, last of the singles", () => {
    expect(GIFT_ITEMS.find((i) => i.slug === "luxury-red-rose")).toEqual({
      slug: "luxury-red-rose",
      kind: "STICKER",
      assetKey: "luxury-red-rose",
      sortOrder: 130,
    });
    expect(GIFT_PRODUCTS.find((p) => p.sku === "gift-luxury-red-rose")).toEqual({
      sku: "gift-luxury-red-rose",
      isBox: false,
      webPriceMinor: 999,
      currency: "USD",
      sortOrder: 130,
      items: [{ slug: "luxury-red-rose", quantity: 1 }],
    });
    const singles = GIFT_PRODUCTS.filter((p) => !p.isBox).sort((a, b) => a.sortOrder - b.sortOrder);
    expect(Math.max(...singles.map((p) => p.webPriceMinor))).toBe(999);
    expect(singles.at(-1)?.sku).toBe("gift-luxury-red-rose");
    expect(GIFT_ITEMS).toHaveLength(13);
    expect(GIFT_PRODUCTS).toHaveLength(16);
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
