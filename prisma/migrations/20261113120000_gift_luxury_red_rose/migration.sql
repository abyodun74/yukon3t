-- Digital gifts: one more catalog item, "Luxury Red Rose" (a sticker whose art is a picture, public/gifts/), sold on its
-- own for USD 9.99, the most premium single gift. Same shape and safety as 20261112180300_gifts_catalog_seed (left
-- untouched): fixed ids, upserts only, so re-running updates in place and never duplicates. src/lib/gifts-data.ts is
-- the same list as data; gifts-data.test.ts checks the two agree.

-- Item
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_luxury-red-rose', 'luxury-red-rose', 'STICKER'::"GiftItemKind", 'luxury-red-rose', true, 130)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Product (the item on its own)
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_gift-luxury-red-rose', 'gift-luxury-red-rose', false, 999, 'USD', true, 130)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What the product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_gift-luxury-red-rose_luxury-red-rose', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'gift-luxury-red-rose'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'luxury-red-rose'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";
