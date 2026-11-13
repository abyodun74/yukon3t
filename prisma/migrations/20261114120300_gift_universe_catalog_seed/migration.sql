-- Digital gifts, Phase A: the five-universe catalog additions (Love & Emotion, Celebrate & Inspire, Gaming Arena,
-- Luxury Universe, Culture & Community) and the free "kind words" (price 0, sent by sendFreeGift). Same shape and
-- safety as 20261112180300_gifts_catalog_seed (left untouched): fixed ids, upserts only, so re-running updates in
-- place and never duplicates; then each new row's Phase A metadata, by slug / sku. src/lib/gifts-data.ts is the
-- same list as data; gifts-data.test.ts checks the two agree. Every price is at or under USD 19.99.

-- Items
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_heartbeat-note', 'heartbeat-note', 'STICKER'::"GiftItemKind", 'heartbeat-note', true, 140),
  ('gift_item_paper-crane', 'paper-crane', 'STICKER'::"GiftItemKind", 'paper-crane', true, 150),
  ('gift_item_forget-me-not', 'forget-me-not', 'STICKER'::"GiftItemKind", 'forget-me-not', true, 160),
  ('gift_item_birthday-candle', 'birthday-candle', 'STICKER'::"GiftItemKind", 'birthday-candle', true, 170),
  ('gift_item_cake-slice', 'cake-slice', 'STICKER'::"GiftItemKind", 'cake-slice', true, 180),
  ('gift_item_grad-cap', 'grad-cap', 'STICKER'::"GiftItemKind", 'grad-cap', true, 190),
  ('gift_item_gold-star', 'gold-star', 'STICKER'::"GiftItemKind", 'gold-star', true, 200),
  ('gift_item_gg-badge', 'gg-badge', 'BADGE'::"GiftItemKind", 'gg-badge', true, 210),
  ('gift_item_level-up', 'level-up', 'LIVE_EFFECT'::"GiftItemKind", 'level-up', true, 220),
  ('gift_item_trophy-frame', 'trophy-frame', 'FRAME'::"GiftItemKind", 'trophy-frame', true, 230),
  ('gift_item_pixel-heart', 'pixel-heart', 'STICKER'::"GiftItemKind", 'pixel-heart', true, 240),
  ('gift_item_gold-orchid', 'gold-orchid', 'STICKER'::"GiftItemKind", 'gold-orchid', true, 250),
  ('gift_item_midnight-crystal-frame', 'midnight-crystal-frame', 'FRAME'::"GiftItemKind", 'midnight-crystal-frame', true, 260),
  ('gift_item_lantern', 'lantern', 'STICKER'::"GiftItemKind", 'lantern', true, 270),
  ('gift_item_shared-table', 'shared-table', 'STICKER'::"GiftItemKind", 'shared-table', true, 280),
  ('gift_item_thank-you', 'thank-you', 'STICKER'::"GiftItemKind", 'thank-you', true, 300),
  ('gift_item_appreciate-you', 'appreciate-you', 'STICKER'::"GiftItemKind", 'appreciate-you', true, 310),
  ('gift_item_cheering-you-on', 'cheering-you-on', 'STICKER'::"GiftItemKind", 'cheering-you-on', true, 320),
  ('gift_item_proud-of-you', 'proud-of-you', 'STICKER'::"GiftItemKind", 'proud-of-you', true, 330)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Products (one per item, the boxes, and the free kind words)
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_sticker.heartbeat-note', 'sticker.heartbeat-note', false, 99, 'USD', true, 140),
  ('gift_product_sticker.paper-crane', 'sticker.paper-crane', false, 99, 'USD', true, 150),
  ('gift_product_sticker.forget-me-not', 'sticker.forget-me-not', false, 99, 'USD', true, 160),
  ('gift_product_sticker.birthday-candle', 'sticker.birthday-candle', false, 99, 'USD', true, 170),
  ('gift_product_sticker.cake-slice', 'sticker.cake-slice', false, 99, 'USD', true, 180),
  ('gift_product_sticker.grad-cap', 'sticker.grad-cap', false, 199, 'USD', true, 190),
  ('gift_product_sticker.gold-star', 'sticker.gold-star', false, 99, 'USD', true, 200),
  ('gift_product_badge.gg', 'badge.gg', false, 199, 'USD', true, 210),
  ('gift_product_live.level-up', 'live.level-up', false, 199, 'USD', true, 220),
  ('gift_product_frame.trophy', 'frame.trophy', false, 299, 'USD', true, 230),
  ('gift_product_sticker.pixel-heart', 'sticker.pixel-heart', false, 99, 'USD', true, 240),
  ('gift_product_sticker.gold-orchid', 'sticker.gold-orchid', false, 499, 'USD', true, 250),
  ('gift_product_frame.midnight-crystal', 'frame.midnight-crystal', false, 499, 'USD', true, 260),
  ('gift_product_sticker.lantern', 'sticker.lantern', false, 99, 'USD', true, 270),
  ('gift_product_sticker.shared-table', 'sticker.shared-table', false, 199, 'USD', true, 280),
  ('gift_product_box.love-letter', 'box.love-letter', true, 499, 'USD', true, 400),
  ('gift_product_box.party', 'box.party', true, 499, 'USD', true, 410),
  ('gift_product_box.champion', 'box.champion', true, 799, 'USD', true, 420),
  ('gift_product_box.harvest', 'box.harvest', true, 499, 'USD', true, 430),
  ('gift_product_free.thank-you', 'free.thank-you', false, 0, 'USD', true, 500),
  ('gift_product_free.appreciate-you', 'free.appreciate-you', false, 0, 'USD', true, 510),
  ('gift_product_free.cheering-you-on', 'free.cheering-you-on', false, 0, 'USD', true, 520),
  ('gift_product_free.proud-of-you', 'free.proud-of-you', false, 0, 'USD', true, 530)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What each product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_sticker.heartbeat-note_heartbeat-note', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.heartbeat-note'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'heartbeat-note'), 1),
  ('gift_pi_sticker.paper-crane_paper-crane', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.paper-crane'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'paper-crane'), 1),
  ('gift_pi_sticker.forget-me-not_forget-me-not', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.forget-me-not'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'forget-me-not'), 1),
  ('gift_pi_sticker.birthday-candle_birthday-candle', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.birthday-candle'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'birthday-candle'), 1),
  ('gift_pi_sticker.cake-slice_cake-slice', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.cake-slice'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'cake-slice'), 1),
  ('gift_pi_sticker.grad-cap_grad-cap', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.grad-cap'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'grad-cap'), 1),
  ('gift_pi_sticker.gold-star_gold-star', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.gold-star'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gold-star'), 1),
  ('gift_pi_badge.gg_gg-badge', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'badge.gg'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gg-badge'), 1),
  ('gift_pi_live.level-up_level-up', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'live.level-up'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'level-up'), 1),
  ('gift_pi_frame.trophy_trophy-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'frame.trophy'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'trophy-frame'), 1),
  ('gift_pi_sticker.pixel-heart_pixel-heart', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.pixel-heart'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'pixel-heart'), 1),
  ('gift_pi_sticker.gold-orchid_gold-orchid', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.gold-orchid'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gold-orchid'), 1),
  ('gift_pi_frame.midnight-crystal_midnight-crystal-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'frame.midnight-crystal'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'midnight-crystal-frame'), 1),
  ('gift_pi_sticker.lantern_lantern', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.lantern'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'lantern'), 1),
  ('gift_pi_sticker.shared-table_shared-table', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.shared-table'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'shared-table'), 1),
  ('gift_pi_box.love-letter_heartbeat-note', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.love-letter'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'heartbeat-note'), 1),
  ('gift_pi_box.love-letter_paper-crane', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.love-letter'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'paper-crane'), 1),
  ('gift_pi_box.love-letter_forget-me-not', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.love-letter'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'forget-me-not'), 1),
  ('gift_pi_box.party_birthday-candle', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.party'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'birthday-candle'), 1),
  ('gift_pi_box.party_cake-slice', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.party'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'cake-slice'), 1),
  ('gift_pi_box.party_confetti', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.party'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'confetti'), 1),
  ('gift_pi_box.champion_gg-badge', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.champion'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gg-badge'), 1),
  ('gift_pi_box.champion_level-up', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.champion'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'level-up'), 1),
  ('gift_pi_box.champion_trophy-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.champion'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'trophy-frame'), 1),
  ('gift_pi_box.champion_pixel-heart', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.champion'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'pixel-heart'), 1),
  ('gift_pi_box.harvest_lantern', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.harvest'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'lantern'), 1),
  ('gift_pi_box.harvest_shared-table', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.harvest'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'shared-table'), 1),
  ('gift_pi_box.harvest_coffee', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.harvest'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'coffee'), 1),
  ('gift_pi_free.thank-you_thank-you', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'free.thank-you'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'thank-you'), 1),
  ('gift_pi_free.appreciate-you_appreciate-you', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'free.appreciate-you'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'appreciate-you'), 1),
  ('gift_pi_free.cheering-you-on_cheering-you-on', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'free.cheering-you-on'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'cheering-you-on'), 1),
  ('gift_pi_free.proud-of-you_proud-of-you', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'free.proud-of-you'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'proud-of-you'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";

-- Phase A metadata: items
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'heartbeat-note';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'paper-crane';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'anniversary']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'forget-me-not';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'birthday-candle';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday', 'anniversary']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'cake-slice';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'milestones', "occasionTags" = ARRAY['graduation', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'grad-cap';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'milestones', "occasionTags" = ARRAY['achievement', 'graduation', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'gold-star';
UPDATE "GiftItem" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'gg-badge';
UPDATE "GiftItem" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'level-up';
UPDATE "GiftItem" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'trophy-frame';
UPDATE "GiftItem" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'pixel-heart';
UPDATE "GiftItem" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary', 'achievement']::TEXT[], "rarity" = 'EDITION'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'gold-orchid';
UPDATE "GiftItem" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['anniversary', 'birthday']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'midnight-crystal-frame';
UPDATE "GiftItem" SET "universe" = 'CULTURE'::"GiftUniverse", "collection" = 'gatherings', "occasionTags" = ARRAY['holiday', 'community']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'lantern';
UPDATE "GiftItem" SET "universe" = 'CULTURE'::"GiftUniverse", "collection" = 'gatherings', "occasionTags" = ARRAY['holiday', 'community', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'shared-table';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'thank-you';
UPDATE "GiftItem" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'appreciate-you';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'cheering-you-on';
UPDATE "GiftItem" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "editionSize" = NULL, "availableFrom" = NULL, "availableUntil" = NULL WHERE "slug" = 'proud-of-you';

-- Phase A metadata: products
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.heartbeat-note';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.paper-crane';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'anniversary']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.forget-me-not';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.birthday-candle';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday', 'anniversary']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.cake-slice';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'milestones', "occasionTags" = ARRAY['graduation', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.grad-cap';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'milestones', "occasionTags" = ARRAY['achievement', 'graduation', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.gold-star';
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'badge.gg';
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'live.level-up';
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'frame.trophy';
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.pixel-heart';
UPDATE "GiftProduct" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['love', 'anniversary', 'achievement']::TEXT[], "rarity" = 'EDITION'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.gold-orchid';
UPDATE "GiftProduct" SET "universe" = 'LUXURY'::"GiftUniverse", "collection" = 'atelier', "occasionTags" = ARRAY['anniversary', 'birthday']::TEXT[], "rarity" = 'PREMIUM'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'frame.midnight-crystal';
UPDATE "GiftProduct" SET "universe" = 'CULTURE'::"GiftUniverse", "collection" = 'gatherings', "occasionTags" = ARRAY['holiday', 'community']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.lantern';
UPDATE "GiftProduct" SET "universe" = 'CULTURE'::"GiftUniverse", "collection" = 'gatherings', "occasionTags" = ARRAY['holiday', 'community', 'appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'sticker.shared-table';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'tender', "occasionTags" = ARRAY['love', 'anniversary']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'box.love-letter';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'party', "occasionTags" = ARRAY['birthday']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'box.party';
UPDATE "GiftProduct" SET "universe" = 'GAMING'::"GiftUniverse", "collection" = 'arena', "occasionTags" = ARRAY['tournament_win', 'achievement']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'box.champion';
UPDATE "GiftProduct" SET "universe" = 'CULTURE'::"GiftUniverse", "collection" = 'gatherings', "occasionTags" = ARRAY['holiday', 'community']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'box.harvest';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'free.thank-you';
UPDATE "GiftProduct" SET "universe" = 'LOVE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'free.appreciate-you';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'free.cheering-you-on';
UPDATE "GiftProduct" SET "universe" = 'CELEBRATE'::"GiftUniverse", "collection" = 'kind-words', "occasionTags" = ARRAY['appreciation']::TEXT[], "rarity" = 'STANDARD'::"GiftRarity", "availableFrom" = NULL, "availableUntil" = NULL WHERE "sku" = 'free.proud-of-you';
