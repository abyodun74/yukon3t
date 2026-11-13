-- Gift Universe Phase B: the SYSTEM_AWARD purchase provider alone (the free Champion badge the app gives a challenge
-- winner, src/lib/challenge-awards.ts), in a migration of its own: Postgres can't use an enum value in the same
-- transaction that added it. IF NOT EXISTS so a re-run is a no-op. Additive only.
ALTER TYPE "GiftPurchaseProvider" ADD VALUE IF NOT EXISTS 'SYSTEM_AWARD';