-- Gift marketplace + Y3T Coins (src/lib/gift-market.ts, src/lib/coins.ts, src/lib/coin-wallet.ts). Additive and
-- idempotent: three new enum types, four new columns (all nullable or with a default, so every existing row keeps its
-- meaning: an existing purchase has quantity 1, an existing product has no coin price / category / tier until the
-- catalog seed 20261201120300 sets them), three new tables, their keys, hand-written CHECKs (Prisma doesn't diff
-- CHECK constraints, so they cause no drift) and one trigger that keeps the coin ledger append-only (Prisma doesn't
-- model triggers either). Nothing is dropped, renamed or deleted, no existing row is changed, and no pgvector HNSW
-- index is touched. The enum values it relies on (GiftPurchaseProvider COINS, AuditAction COINS_GRANTED) were added by
-- 20261201120000 / 20261201120100, each in a migration of its own; nothing here uses them.
--
-- Coins are granted by YuKon3t only: nothing here (or anywhere) sells them.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftCategory') THEN
    CREATE TYPE "GiftCategory" AS ENUM ('LOVE_ROMANCE', 'BIRTHDAY', 'CONGRATULATIONS', 'LUXURY', 'CUTE_FUN', 'GAMING', 'LIFESTYLE', 'CELEBRATION', 'SPECIAL_MOMENTS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftTier') THEN
    CREATE TYPE "GiftTier" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CoinLedgerKind') THEN
    CREATE TYPE "CoinLedgerKind" AS ENUM ('GRANT', 'SPEND', 'REFUND');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "category" "GiftCategory";
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "coinPrice" INTEGER;
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "tier" "GiftTier";

-- AlterTable
ALTER TABLE "GiftPurchase" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoinWallet" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinWallet_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CoinLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CoinLedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "purchaseId" TEXT,
    "grantedById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoinLedgerEntry_userId_createdAt_idx" ON "CoinLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CoinLedgerEntry_purchaseId_idx" ON "CoinLedgerEntry"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CoinLedgerEntry_userId_idempotencyKey_key" ON "CoinLedgerEntry"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GiftFavorite_userId_productId_key" ON "GiftFavorite"("userId", "productId");

-- AddForeignKey, and hand-written CHECKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinWallet_userId_fkey') THEN
    ALTER TABLE "CoinWallet" ADD CONSTRAINT "CoinWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinLedgerEntry_userId_fkey') THEN
    ALTER TABLE "CoinLedgerEntry" ADD CONSTRAINT "CoinLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftFavorite_userId_fkey') THEN
    ALTER TABLE "GiftFavorite" ADD CONSTRAINT "GiftFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftFavorite_productId_fkey') THEN
    ALTER TABLE "GiftFavorite" ADD CONSTRAINT "GiftFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GiftProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- A wallet never goes below zero (spends are guarded decrements; this backs them up). The grant cap
  -- (COIN_BALANCE_MAX) is enforced by the grant itself, so a refund can always land.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinWallet_balance_nonnegative') THEN
    ALTER TABLE "CoinWallet" ADD CONSTRAINT "CoinWallet_balance_nonnegative" CHECK ("balance" >= 0);
  END IF;
  -- A ledger entry moves coins in the direction of its kind, and never leaves a negative balance.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinLedgerEntry_amount_sign') THEN
    ALTER TABLE "CoinLedgerEntry" ADD CONSTRAINT "CoinLedgerEntry_amount_sign" CHECK (
      ("kind" = 'SPEND' AND "amount" < 0) OR ("kind" IN ('GRANT', 'REFUND') AND "amount" > 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CoinLedgerEntry_balance_after') THEN
    ALTER TABLE "CoinLedgerEntry" ADD CONSTRAINT "CoinLedgerEntry_balance_after" CHECK ("balanceAfter" >= 0);
  END IF;
  -- A coin price, when there is one, is a positive whole number of coins (COIN_PRICE_MAX).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftProduct_coin_price_range') THEN
    ALTER TABLE "GiftProduct" ADD CONSTRAINT "GiftProduct_coin_price_range" CHECK ("coinPrice" IS NULL OR "coinPrice" BETWEEN 1 AND 100000);
  END IF;
  -- One purchase gives 1 to 10 of its product (GIFT_QUANTITY_MAX).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftPurchase_quantity_range') THEN
    ALTER TABLE "GiftPurchase" ADD CONSTRAINT "GiftPurchase_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
  END IF;
END $$;

-- The coin ledger is append-only: a row is never changed once written (a correction is a new row). Rows still go with
-- their account (ON DELETE CASCADE from "User"), so DELETE is not blocked.
CREATE OR REPLACE FUNCTION "coin_ledger_entry_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CoinLedgerEntry rows are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'CoinLedgerEntry_no_update') THEN
    CREATE TRIGGER "CoinLedgerEntry_no_update" BEFORE UPDATE ON "CoinLedgerEntry"
      FOR EACH ROW EXECUTE FUNCTION "coin_ledger_entry_immutable"();
  END IF;
END $$;
