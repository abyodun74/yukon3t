-- Digital gifts, Phase A (free appreciation gifts, src/lib/gifts.ts): the FREE purchase provider alone, in a migration of
-- its own: Postgres can't use an enum value in the same transaction that added it. IF NOT EXISTS so a re-run is a
-- no-op. Additive only: nothing is dropped.
ALTER TYPE "GiftPurchaseProvider" ADD VALUE IF NOT EXISTS 'FREE';
