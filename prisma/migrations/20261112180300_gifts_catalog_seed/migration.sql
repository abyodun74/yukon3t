-- Digital gifts, Phase 1: the catalog (src/lib/gifts-data.ts is the same list as data; gifts-data.test.ts checks the
-- two agree). Safe to re-run: every row has a fixed id and is upserted, so running it again (or after a price or
-- order change made here) updates in place and never duplicates. Store product ids are left null until the payments
-- phases create the products in App Store Connect / the Play Console. Prices are USD store tiers in cents.

-- Items
INSERT INTO "GiftItem" ("id", "slug", "kind", "assetKey", "active", "sortOrder") VALUES
  ('gift_item_wave', 'wave', 'STICKER'::"GiftItemKind", 'wave', true, 10),
  ('gift_item_heart-burst', 'heart-burst', 'STICKER'::"GiftItemKind", 'heart-burst', true, 20),
  ('gift_item_high-five', 'high-five', 'STICKER'::"GiftItemKind", 'high-five', true, 30),
  ('gift_item_coffee', 'coffee', 'STICKER'::"GiftItemKind", 'coffee', true, 40),
  ('gift_item_rose', 'rose', 'STICKER'::"GiftItemKind", 'rose', true, 50),
  ('gift_item_supporter-star', 'supporter-star', 'BADGE'::"GiftItemKind", 'supporter-star', true, 60),
  ('gift_item_kindred-spirit', 'kindred-spirit', 'BADGE'::"GiftItemKind", 'kindred-spirit', true, 70),
  ('gift_item_aurora-frame', 'aurora-frame', 'FRAME'::"GiftItemKind", 'aurora-frame', true, 80),
  ('gift_item_frost-frame', 'frost-frame', 'FRAME'::"GiftItemKind", 'frost-frame', true, 90),
  ('gift_item_gold-ring-frame', 'gold-ring-frame', 'FRAME'::"GiftItemKind", 'gold-ring-frame', true, 100),
  ('gift_item_confetti', 'confetti', 'LIVE_EFFECT'::"GiftItemKind", 'confetti', true, 110),
  ('gift_item_aurora-sweep', 'aurora-sweep', 'LIVE_EFFECT'::"GiftItemKind", 'aurora-sweep', true, 120)
ON CONFLICT ("slug") DO UPDATE SET "kind" = EXCLUDED."kind", "assetKey" = EXCLUDED."assetKey", "sortOrder" = EXCLUDED."sortOrder";

-- Products (one per item, plus the boxes)
INSERT INTO "GiftProduct" ("id", "sku", "isBox", "webPriceMinor", "currency", "active", "sortOrder") VALUES
  ('gift_product_sticker.wave', 'sticker.wave', false, 99, 'USD', true, 10),
  ('gift_product_sticker.heart-burst', 'sticker.heart-burst', false, 99, 'USD', true, 20),
  ('gift_product_sticker.high-five', 'sticker.high-five', false, 99, 'USD', true, 30),
  ('gift_product_sticker.coffee', 'sticker.coffee', false, 99, 'USD', true, 40),
  ('gift_product_sticker.rose', 'sticker.rose', false, 99, 'USD', true, 50),
  ('gift_product_badge.supporter-star', 'badge.supporter-star', false, 199, 'USD', true, 60),
  ('gift_product_badge.kindred-spirit', 'badge.kindred-spirit', false, 199, 'USD', true, 70),
  ('gift_product_frame.aurora', 'frame.aurora', false, 299, 'USD', true, 80),
  ('gift_product_frame.frost', 'frame.frost', false, 299, 'USD', true, 90),
  ('gift_product_frame.gold-ring', 'frame.gold-ring', false, 299, 'USD', true, 100),
  ('gift_product_live.confetti', 'live.confetti', false, 199, 'USD', true, 110),
  ('gift_product_live.aurora-sweep', 'live.aurora-sweep', false, 499, 'USD', true, 120),
  ('gift_product_box.say-hi', 'box.say-hi', true, 199, 'USD', true, 200),
  ('gift_product_box.celebration', 'box.celebration', true, 499, 'USD', true, 210),
  ('gift_product_box.aurora', 'box.aurora', true, 799, 'USD', true, 220)
ON CONFLICT ("sku") DO UPDATE SET "isBox" = EXCLUDED."isBox", "webPriceMinor" = EXCLUDED."webPriceMinor", "currency" = EXCLUDED."currency", "sortOrder" = EXCLUDED."sortOrder";

-- What each product contains
INSERT INTO "GiftProductItem" ("id", "productId", "itemId", "quantity") VALUES
  ('gift_pi_sticker.wave_wave', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.wave'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'wave'), 1),
  ('gift_pi_sticker.heart-burst_heart-burst', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.heart-burst'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'heart-burst'), 1),
  ('gift_pi_sticker.high-five_high-five', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.high-five'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'high-five'), 1),
  ('gift_pi_sticker.coffee_coffee', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.coffee'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'coffee'), 1),
  ('gift_pi_sticker.rose_rose', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'sticker.rose'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'rose'), 1),
  ('gift_pi_badge.supporter-star_supporter-star', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'badge.supporter-star'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'supporter-star'), 1),
  ('gift_pi_badge.kindred-spirit_kindred-spirit', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'badge.kindred-spirit'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'kindred-spirit'), 1),
  ('gift_pi_frame.aurora_aurora-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'frame.aurora'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'aurora-frame'), 1),
  ('gift_pi_frame.frost_frost-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'frame.frost'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'frost-frame'), 1),
  ('gift_pi_frame.gold-ring_gold-ring-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'frame.gold-ring'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gold-ring-frame'), 1),
  ('gift_pi_live.confetti_confetti', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'live.confetti'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'confetti'), 1),
  ('gift_pi_live.aurora-sweep_aurora-sweep', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'live.aurora-sweep'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'aurora-sweep'), 1),
  ('gift_pi_box.say-hi_wave', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.say-hi'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'wave'), 1),
  ('gift_pi_box.say-hi_high-five', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.say-hi'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'high-five'), 1),
  ('gift_pi_box.say-hi_coffee', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.say-hi'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'coffee'), 1),
  ('gift_pi_box.celebration_heart-burst', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.celebration'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'heart-burst'), 1),
  ('gift_pi_box.celebration_rose', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.celebration'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'rose'), 1),
  ('gift_pi_box.celebration_confetti', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.celebration'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'confetti'), 1),
  ('gift_pi_box.celebration_gold-ring-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.celebration'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'gold-ring-frame'), 1),
  ('gift_pi_box.aurora_aurora-frame', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.aurora'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'aurora-frame'), 1),
  ('gift_pi_box.aurora_aurora-sweep', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.aurora'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'aurora-sweep'), 1),
  ('gift_pi_box.aurora_supporter-star', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.aurora'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'supporter-star'), 1),
  ('gift_pi_box.aurora_wave', (SELECT "id" FROM "GiftProduct" WHERE "sku" = 'box.aurora'), (SELECT "id" FROM "GiftItem" WHERE "slug" = 'wave'), 1)
ON CONFLICT ("productId", "itemId") DO UPDATE SET "quantity" = EXCLUDED."quantity";
