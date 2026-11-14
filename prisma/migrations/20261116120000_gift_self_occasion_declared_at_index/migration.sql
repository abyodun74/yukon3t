-- The daily prune-gift-occasions cron (src/app/api/cron/prune-gift-occasions/route.ts) deletes self-declared gift
-- occasions older than 30 days across all users (WHERE "declaredAt" < cutoff ORDER BY "declaredAt"). The existing
-- ("userId", "declaredAt") index can't serve that without a scan, so this adds one on "declaredAt" alone.
-- Additive and idempotent: one new index on a small table. Nothing is dropped, and no pgvector HNSW index is touched.
CREATE INDEX IF NOT EXISTS "GiftSelfOccasion_declaredAt_idx" ON "GiftSelfOccasion"("declaredAt");
