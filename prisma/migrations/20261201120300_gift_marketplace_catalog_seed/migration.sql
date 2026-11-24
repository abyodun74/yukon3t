-- Gift marketplace (src/lib/gift-market.ts): the catalog half. Same shape and safety as every earlier catalog seed
-- (20261112180300_gifts_catalog_seed and after, all left untouched): fixed ids, upserts only, so re-running updates in
-- place and never duplicates, deletes or renumbers anything. src/lib/gifts-data.ts is the same list as data
-- (GIFT_ITEMS / GIFT_PRODUCTS / GIFT_MARKET / GIFT_BOX_COIN_PRICES); gifts-data.test.ts checks the two agree.
--
-- 1. Eight new single gifts (hand-authored placeholder SVG art in src/components/gift-art.tsx), so each of the nine
--    marketplace categories has four launch gifts, with their Phase A metadata by slug / sku.
-- 2. Y3T Coin prices and the marketplace fields (category, tier, featured) for the 36 launch gifts: the 28 existing
--    single gifts, each mapped into one category, plus the eight new ones. Existing rows keep their id, sku, USD tier,
--    universe, rarity, editions and every owned / sent record; only the new, previously NULL columns are filled.
-- 3. Coin prices for the seven existing boxes (still sendable from the gift picker; no category, so not in the
--    marketplace grid). Free gifts and awards get no coin price.
--
-- Nothing is deactivated: every existing gift stays sendable.

-- Items
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_birthday-balloons', 'birthday-balloons', 'STICKER'::"GiftItemKind", 'birthday-balloons', true, 700),
  ('gift_item_teddy-bear', 'teddy-bear', 'STICKER'::"GiftItemKind", 'teddy-bear', true, 710),
  ('gift_item_playful-kitten', 'playful-kitten', 'STICKER'::"GiftItemKind", 'playful-kitten', true, 720),
  ('gift_item_houseplant', 'houseplant', 'STICKER'::"GiftItemKind", 'houseplant', true, 730),
  ('gift_item_sunset-postcard', 'sunset-postcard', 'STICKER'::"GiftItemKind", 'sunset-postcard', true, 740),
  ('gift_item_fireworks', 'fireworks', 'STICKER'::"GiftItemKind", 'fireworks', true, 750),
  ('gift_item_shooting-star', 'shooting-star', 'STICKER'::"GiftItemKind", 'shooting-star', true, 760),
  ('gift_item_keepsake-locket', 'keepsake-locket', 'STICKER'::"GiftItemKind", 'keepsake-locket', true, 770)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Products (one per new item)
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_sticker.birthday-balloons', 'sticker.birthday-balloons', false, 499, 'USD', true, 700),
  ('gift_product_sticker.teddy-bear', 'sticker.teddy-bear', false, 199, 'USD', true, 710),
  ('gift_product_sticker.playful-kitten', 'sticker.playful-kitten', false, 499, 'USD', true, 720),
  ('gift_product_sticker.houseplant', 'sticker.houseplant', false, 99, 'USD', true, 730),
  ('gift_product_sticker.sunset-postcard', 'sticker.sunset-postcard', false, 499, 'USD', true, 740),
  ('gift_product_sticker.fireworks', 'sticker.fireworks', false, 499, 'USD', true, 750),
  ('gift_product_sticker.shooting-star', 'sticker.shooting-star', false, 199, 'USD', true, 760),
  ('gift_product_sticker.keepsake-locket', 'sticker.keepsake-locket', false, 999, 'USD', true, 770)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What each product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_sticker.birthday-balloons_birthday-balloons', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.birthday-balloons'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'birthday-balloons'), 1),
  ('gift_pi_sticker.teddy-bear_teddy-bear', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.teddy-bear'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'teddy-bear'), 1),
  ('gift_pi_sticker.playful-kitten_playful-kitten', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.playful-kitten'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'playful-kitten'), 1),
  ('gift_pi_sticker.houseplant_houseplant', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.houseplant'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'houseplant'), 1),
  ('gift_pi_sticker.sunset-postcard_sunset-postcard', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.sunset-postcard'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'sunset-postcard'), 1),
  ('gift_pi_sticker.fireworks_fireworks', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.fireworks'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'fireworks'), 1),
  ('gift_pi_sticker.shooting-star_shooting-star', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.shooting-star'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'shooting-star'), 1),
  ('gift_pi_sticker.keepsake-locket_keepsake-locket', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.keepsake-locket'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'keepsake-locket'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";

-- Phase A metadata: items
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'birthday-balloons';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'teddy-bear';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'cute', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'playful-kitten';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'everyday', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'houseplant';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'everyday', "occasionTags" = ARRAY['appreciation', 'community']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'sunset-postcard';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday', 'achievement', 'holiday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'fireworks';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'shooting-star';
UPDATE "GiftItem" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'keepsake-locket';

-- Phase A metadata: products
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.birthday-balloons';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.teddy-bear';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'cute', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.playful-kitten';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'everyday', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.houseplant';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'everyday', "occasionTags" = ARRAY['appreciation', 'community']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.sunset-postcard';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday', 'achievement', 'holiday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.fireworks';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.shooting-star';
UPDATE "GiftProduct" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.keepsake-locket';

-- Marketplace: the 36 launch gifts (coin price, category, tier, featured)
UPDATE "GiftProduct" SET "coinPrice" = 25, "category" = 'LOVE_ROMANCE'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.rose';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'LOVE_ROMANCE'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.heart-burst';
UPDATE "GiftProduct" SET "coinPrice" = 90, "category" = 'LOVE_ROMANCE'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.heartbeat-note';
UPDATE "GiftProduct" SET "coinPrice" = 300, "category" = 'LOVE_ROMANCE'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'badge.kindred-spirit';
UPDATE "GiftProduct" SET "coinPrice" = 25, "category" = 'BIRTHDAY'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.birthday-candle';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'BIRTHDAY'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.cake-slice';
UPDATE "GiftProduct" SET "coinPrice" = 120, "category" = 'BIRTHDAY'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'frame.frost';
UPDATE "GiftProduct" SET "coinPrice" = 280, "category" = 'BIRTHDAY'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'sticker.birthday-balloons';
UPDATE "GiftProduct" SET "coinPrice" = 20, "category" = 'CONGRATULATIONS'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.high-five';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'CONGRATULATIONS'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.gold-star';
UPDATE "GiftProduct" SET "coinPrice" = 100, "category" = 'CONGRATULATIONS'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.grad-cap';
UPDATE "GiftProduct" SET "coinPrice" = 250, "category" = 'CONGRATULATIONS'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'badge.supporter-star';
UPDATE "GiftProduct" SET "coinPrice" = 150, "category" = 'LUXURY'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'frame.gold-ring';
UPDATE "GiftProduct" SET "coinPrice" = 400, "category" = 'LUXURY'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'frame.midnight-crystal';
UPDATE "GiftProduct" SET "coinPrice" = 900, "category" = 'LUXURY'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.gold-orchid';
UPDATE "GiftProduct" SET "coinPrice" = 1500, "category" = 'LUXURY'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'gift-luxury-red-rose';
UPDATE "GiftProduct" SET "coinPrice" = 20, "category" = 'CUTE_FUN'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.wave';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'CUTE_FUN'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.paper-crane';
UPDATE "GiftProduct" SET "coinPrice" = 90, "category" = 'CUTE_FUN'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'sticker.teddy-bear';
UPDATE "GiftProduct" SET "coinPrice" = 260, "category" = 'CUTE_FUN'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.playful-kitten';
UPDATE "GiftProduct" SET "coinPrice" = 25, "category" = 'GAMING'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.pixel-heart';
UPDATE "GiftProduct" SET "coinPrice" = 100, "category" = 'GAMING'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'badge.gg';
UPDATE "GiftProduct" SET "coinPrice" = 250, "category" = 'GAMING'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'live.level-up';
UPDATE "GiftProduct" SET "coinPrice" = 750, "category" = 'GAMING'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'frame.trophy';
UPDATE "GiftProduct" SET "coinPrice" = 20, "category" = 'LIFESTYLE'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.coffee';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'LIFESTYLE'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.houseplant';
UPDATE "GiftProduct" SET "coinPrice" = 80, "category" = 'LIFESTYLE'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.shared-table';
UPDATE "GiftProduct" SET "coinPrice" = 260, "category" = 'LIFESTYLE'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.sunset-postcard';
UPDATE "GiftProduct" SET "coinPrice" = 40, "category" = 'CELEBRATION'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'live.confetti';
UPDATE "GiftProduct" SET "coinPrice" = 90, "category" = 'CELEBRATION'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.lantern';
UPDATE "GiftProduct" SET "coinPrice" = 350, "category" = 'CELEBRATION'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'sticker.fireworks';
UPDATE "GiftProduct" SET "coinPrice" = 800, "category" = 'CELEBRATION'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'live.aurora-sweep';
UPDATE "GiftProduct" SET "coinPrice" = 30, "category" = 'SPECIAL_MOMENTS'::"GiftCategory", "tier" = 'COMMON'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.forget-me-not';
UPDATE "GiftProduct" SET "coinPrice" = 120, "category" = 'SPECIAL_MOMENTS'::"GiftCategory", "tier" = 'RARE'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'sticker.shooting-star';
UPDATE "GiftProduct" SET "coinPrice" = 380, "category" = 'SPECIAL_MOMENTS'::"GiftCategory", "tier" = 'EPIC'::"GiftTier", "featured" = false WHERE "GiftProduct"."sku" = 'frame.aurora';
UPDATE "GiftProduct" SET "coinPrice" = 1000, "category" = 'SPECIAL_MOMENTS'::"GiftCategory", "tier" = 'LEGENDARY'::"GiftTier", "featured" = true WHERE "GiftProduct"."sku" = 'sticker.keepsake-locket';

-- Boxes: a coin price only (sendable from the gift picker, not in the marketplace grid)
UPDATE "GiftProduct" SET "coinPrice" = 60, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.say-hi';
UPDATE "GiftProduct" SET "coinPrice" = 300, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.celebration';
UPDATE "GiftProduct" SET "coinPrice" = 600, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.aurora';
UPDATE "GiftProduct" SET "coinPrice" = 150, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.love-letter';
UPDATE "GiftProduct" SET "coinPrice" = 120, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.party';
UPDATE "GiftProduct" SET "coinPrice" = 900, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.champion';
UPDATE "GiftProduct" SET "coinPrice" = 150, "category" = NULL, "tier" = NULL, "featured" = false WHERE "GiftProduct"."sku" = 'box.harvest';
