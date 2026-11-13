import type { giftsEn } from "@/lib/i18n/en/gifts";

// Names of catalog items and products in the reader's language (the `gifts` dictionary, keyed by slug / sku from
// src/lib/gifts-data.ts). Client-safe and usable from server components alike.

/** An item's name, or its slug for an item this build has no name for. */
export function giftItemName(t: typeof giftsEn, slug: string): string {
  return (t.items as Record<string, { name: string } | undefined>)[slug]?.name ?? slug;
}

/** A product's name: a box has its own; a single gift is its item's. */
export function giftProductName(t: typeof giftsEn, product: { sku: string; isBox: boolean; items: { slug: string }[] }): string {
  if (product.isBox) {
    return (t.boxes as Record<string, { name: string } | undefined>)[product.sku]?.name ?? product.sku;
  }
  return product.items[0] ? giftItemName(t, product.items[0].slug) : product.sku;
}

/** A product's one-line description: a box's own, or its single item's. */
export function giftProductDescription(
  t: typeof giftsEn,
  product: { sku: string; isBox: boolean; items: { slug: string }[] },
): string {
  if (product.isBox) {
    return (t.boxes as Record<string, { description: string } | undefined>)[product.sku]?.description ?? "";
  }
  const slug = product.items[0]?.slug;
  return slug ? ((t.items as Record<string, { description: string } | undefined>)[slug]?.description ?? "") : "";
}
