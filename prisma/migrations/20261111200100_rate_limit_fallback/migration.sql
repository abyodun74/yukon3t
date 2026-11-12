-- Additive only: the database fallback counter for the rate limiters that send email or SMS, used only while Upstash
-- is unavailable (src/lib/rate-limit-db-fallback.ts). Idempotent.
CREATE TABLE IF NOT EXISTS "RateLimitFallback" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitFallback_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "RateLimitFallback_windowStart_idx" ON "RateLimitFallback"("windowStart");
