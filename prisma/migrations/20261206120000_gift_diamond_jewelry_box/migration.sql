-- Diamond Jewelry Gift Box: a new Legendary marketplace gift (Luxury, 2500 Y3T Coins, not featured), the owner's
-- "Legendary Diamond Jewelry Gift Box" art (scripts/slice-gift-art.py --jewelry) and piece No. 6 of the Luxury atelier.
-- Same shape and safety as every earlier catalog seed (all left untouched): fixed ids, upserts only, so re-running
-- updates in place and never duplicates, deletes or renumbers anything; every UPDATE targets this one item / product.
-- src/lib/gifts-data.ts is the same row as data (GIFT_ITEMS / GIFT_PRODUCTS / GIFT_MARKET); gifts-data.test.ts and
-- gift-market.test.ts check the two agree. No new enum value: every value used here already exists.

-- Item
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_diamond-jewelry-box', 'diamond-jewelry-box', 'STICKER'::"GiftItemKind", 'diamond-jewelry-box', true, 780)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Product
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_sticker.diamond-jewelry-box', 'sticker.diamond-jewelry-box', false, 999, 'USD', true, 780)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What the product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_sticker.diamond-jewelry-box_diamond-jewelry-box', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.diamond-jewelry-box'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'diamond-jewelry-box'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";

-- Phase A metadata: item
UPDATE "GiftItem" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary', 'achievement']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'diamond-jewelry-box';

-- Phase A metadata: product
UPDATE "GiftProduct" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary', 'achievement']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.diamond-jewelry-box';

-- Marketplace: coin price, category, tier, featured
UPDATE "GiftProduct" SET "coinPrice" = 2500, "category" = 'LUXURY'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.diamond-jewelry-box';
