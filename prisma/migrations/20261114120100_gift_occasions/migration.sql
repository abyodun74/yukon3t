-- Digital gifts, Phase A ("occasion-aware gifting", src/lib/gift-occasions.ts): catalog metadata (universe, collection,
-- occasion tags, rarity, edition size, a yearly availability window), numbered editions on owned gifts, the
-- once-per-gift free "Thank You", self-declared occasions, the profile showcase and two per-user switches. Additive
-- and idempotent: new enum types (created here, not added to existing ones), new columns with defaults, two new tables
-- and their keys. Nothing is dropped, and no pgvector HNSW index is touched. The metadata of the existing catalog rows
-- is written by 20261114120200_gift_catalog_metadata.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftUniverse') THEN
    CREATE TYPE "GiftUniverse" AS ENUM ('LOVE', 'CELEBRATE', 'GAMING', 'LUXURY', 'CULTURE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftRarity') THEN
    CREATE TYPE "GiftRarity" AS ENUM ('STANDARD', 'PREMIUM', 'EDITION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftSelfOccasionKind') THEN
    CREATE TYPE "GiftSelfOccasionKind" AS ENUM ('GRADUATION', 'NEW_JOB', 'ACHIEVEMENT', 'MILESTONE');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftAnniversaryOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftCultureOccasions" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "availableFrom" TEXT;
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "availableUntil" TEXT;
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "collection" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "editionSize" INTEGER;
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "occasionTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "rarity" "GiftRarity" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "GiftItem" ADD COLUMN IF NOT EXISTS "universe" "GiftUniverse" NOT NULL DEFAULT 'CELEBRATE';

-- AlterTable
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "availableFrom" TEXT;
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "availableUntil" TEXT;
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "collection" TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "occasionTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "rarity" "GiftRarity" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "GiftProduct" ADD COLUMN IF NOT EXISTS "universe" "GiftUniverse" NOT NULL DEFAULT 'CELEBRATE';

-- AlterTable
ALTER TABLE "GiftSend" ADD COLUMN IF NOT EXISTS "thanksForSendId" TEXT;

-- AlterTable
ALTER TABLE "OwnedGift" ADD COLUMN IF NOT EXISTS "editionNumber" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftSelfOccasion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GiftSelfOccasionKind" NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "GiftSelfOccasion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftShowcasePin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownedGiftId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftShowcasePin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GiftSelfOccasion_userId_declaredAt_idx" ON "GiftSelfOccasion"("userId", "declaredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftShowcasePin_ownedGiftId_key" ON "GiftShowcasePin"("ownedGiftId");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftShowcasePin_userId_position_key" ON "GiftShowcasePin"("userId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftSend_thanksForSendId_key" ON "GiftSend"("thanksForSendId");
-- Postgres treats NULLs as distinct, so only numbered (EDITION) copies are constrained: one copy per number per item.
CREATE UNIQUE INDEX IF NOT EXISTS "OwnedGift_itemId_editionNumber_key" ON "OwnedGift"("itemId", "editionNumber");

-- AddForeignKey, and hand-written CHECKs (Prisma doesn't diff CHECK constraints, so they cause no drift).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_thanksForSendId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_thanksForSendId_fkey" FOREIGN KEY ("thanksForSendId") REFERENCES "GiftSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSelfOccasion_userId_fkey') THEN
    ALTER TABLE "GiftSelfOccasion" ADD CONSTRAINT "GiftSelfOccasion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftShowcasePin_userId_fkey') THEN
    ALTER TABLE "GiftShowcasePin" ADD CONSTRAINT "GiftShowcasePin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftShowcasePin_ownedGiftId_fkey') THEN
    ALTER TABLE "GiftShowcasePin" ADD CONSTRAINT "GiftShowcasePin_ownedGiftId_fkey" FOREIGN KEY ("ownedGiftId") REFERENCES "OwnedGift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- A showcase holds three gifts (GIFT_SHOWCASE_MAX), positions 0..2.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftShowcasePin_position_range') THEN
    ALTER TABLE "GiftShowcasePin" ADD CONSTRAINT "GiftShowcasePin_position_range" CHECK ("position" >= 0 AND "position" < 3);
  END IF;
  -- Edition numbers start at 1; an edition size, when set, is positive.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OwnedGift_editionNumber_positive') THEN
    ALTER TABLE "OwnedGift" ADD CONSTRAINT "OwnedGift_editionNumber_positive" CHECK ("editionNumber" IS NULL OR "editionNumber" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftItem_editionSize_positive') THEN
    ALTER TABLE "GiftItem" ADD CONSTRAINT "GiftItem_editionSize_positive" CHECK ("editionSize" IS NULL OR "editionSize" >= 1);
  END IF;
  -- The yearly availability window is "MM-DD" (or null).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftItem_available_window_format') THEN
    ALTER TABLE "GiftItem" ADD CONSTRAINT "GiftItem_available_window_format" CHECK (
      ("availableFrom" IS NULL OR "availableFrom" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
      AND ("availableUntil" IS NULL OR "availableUntil" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftProduct_available_window_format') THEN
    ALTER TABLE "GiftProduct" ADD CONSTRAINT "GiftProduct_available_window_format" CHECK (
      ("availableFrom" IS NULL OR "availableFrom" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
      AND ("availableUntil" IS NULL OR "availableUntil" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
    );
  END IF;
  -- The price ceiling (GIFT_PRICE_CEILING_MINOR, USD 19.99) and no negative prices.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftProduct_price_range') THEN
    ALTER TABLE "GiftProduct" ADD CONSTRAINT "GiftProduct_price_range" CHECK ("webPriceMinor" >= 0 AND "webPriceMinor" <= 1999);
  END IF;
END $$;
