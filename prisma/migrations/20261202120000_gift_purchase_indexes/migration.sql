-- Two read paths over every GiftPurchase row that had no index to use:
--
-- 1. The gift marketplace's "Popular" order (loadGiftMarketplace, src/lib/gift-market-data.ts) counts delivered
--    purchases per product on every marketplace load:
--      SELECT "productId", COUNT(*) FROM "GiftPurchase"
--      WHERE "productId" IN (...) AND "status" = 'PAID' GROUP BY "productId"
--    ("productId", "status") serves that as an index-only scan instead of a full table scan.
--
-- 2. The sweep-stuck-gift-purchases cron (src/lib/gift-purchase-sweep.ts) looks for coin purchases left PENDING:
--      SELECT ... FROM "GiftPurchase" WHERE "provider" = 'COINS' AND "status" = 'PENDING' AND "createdAt" < $1
--      ORDER BY "createdAt" ASC LIMIT 50
--    ("status", "createdAt") finds the (normally zero) PENDING rows in order without reading the delivered ones.
--
-- Additive and idempotent: two new indexes, nothing dropped, no pgvector HNSW index touched.
CREATE INDEX IF NOT EXISTS "GiftPurchase_productId_status_idx" ON "GiftPurchase"("productId", "status");
CREATE INDEX IF NOT EXISTS "GiftPurchase_status_createdAt_idx" ON "GiftPurchase"("status", "createdAt");
