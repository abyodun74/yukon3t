-- Gift marketplace: the COINS purchase provider alone (a gift paid with Y3T Coins, src/lib/coin-wallet.ts), in a
-- migration of its own: Postgres can't use an enum value in the same transaction that added it. IF NOT EXISTS so a
-- re-run is a no-op. Additive only. Coins are granted by YuKon3t and can't be bought: this is not a payment provider.
ALTER TYPE "GiftPurchaseProvider" ADD VALUE IF NOT EXISTS 'COINS';
