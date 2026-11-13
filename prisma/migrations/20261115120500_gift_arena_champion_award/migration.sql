-- Gift Universe Phase B: the "Arena Champion" badge, the free award every declared winner of a challenge receives
-- (src/lib/challenge-awards.ts, as a SYSTEM_AWARD gift). Price 0 and tagged tournament_win only (not appreciation), so
-- it is never offered in the gift picker and can't be sent by anyone: only the app awards it. Same shape and safety as
-- 20261112180300_gifts_catalog_seed (left untouched): fixed ids, upserts only, so re-running updates in place and never
-- duplicates; then its Phase A metadata, by slug / sku. src/lib/gifts-data.ts is the same list as data;
-- gifts-data.test.ts checks the two agree.

-- Item
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_arena-champion', 'arena-champion', 'BADGE'::"GiftItemKind", 'arena-champion', true, 600)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Product (the award, never sold)
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_award.arena-champion', 'award.arena-champion', false, 0, 'USD', true, 600)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What the product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_award.arena-champion_arena-champion', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'award.arena-champion'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'arena-champion'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";

-- Phase A metadata: item
UPDATE "GiftItem" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'arena-champion';

-- Phase A metadata: product
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'award.arena-champion';
