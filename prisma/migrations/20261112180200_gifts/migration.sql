-- Digital gifts, Phase 1 (src/lib/gifts.ts): the catalog (GiftItem, GiftProduct, GiftProductItem), purchases, sends
-- and what people own, plus who may send someone a gift and what they have equipped. Additive and idempotent: new
-- enums, tables, columns with defaults and their keys; nothing is dropped or backfilled. The catalog rows themselves
-- are in 20261112180300_gifts_catalog_seed.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftItemKind') THEN
    CREATE TYPE "GiftItemKind" AS ENUM ('STICKER', 'FRAME', 'BADGE', 'LIVE_EFFECT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftsFrom') THEN
    CREATE TYPE "GiftsFrom" AS ENUM ('EVERYONE', 'CONNECTIONS', 'NOBODY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftPurchaseProvider') THEN
    CREATE TYPE "GiftPurchaseProvider" AS ENUM ('ADMIN_GRANT', 'STRIPE', 'APPLE', 'GOOGLE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftPurchaseStatus') THEN
    CREATE TYPE "GiftPurchaseStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'REVOKED', 'MISMATCH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftSendContext') THEN
    CREATE TYPE "GiftSendContext" AS ENUM ('DIRECT', 'CHAT', 'LIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GiftSendStatus') THEN
    CREATE TYPE "GiftSendStatus" AS ENUM ('AWAITING_PAYMENT', 'DELIVERED', 'OPENED', 'UNDELIVERABLE', 'REVOKED', 'HIDDEN_BY_RECIPIENT');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "equippedBadgeItemId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "equippedFrameItemId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftsFrom" "GiftsFrom" NOT NULL DEFAULT 'CONNECTIONS';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "giftSendId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "GiftItemKind" NOT NULL,
    "assetKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "isBox" BOOLEAN NOT NULL DEFAULT false,
    "webPriceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "appleProductId" TEXT,
    "googleProductId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftProductItem" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GiftProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftPurchase" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT,
    "productId" TEXT NOT NULL,
    "provider" "GiftPurchaseProvider" NOT NULL,
    "providerTxnId" TEXT NOT NULL,
    "status" "GiftPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "rawRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "GiftPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GiftSend" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "senderId" TEXT,
    "recipientId" TEXT NOT NULL,
    "message" TEXT,
    "messageModeration" "ModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "context" "GiftSendContext" NOT NULL DEFAULT 'DIRECT',
    "conversationId" TEXT,
    "liveStreamId" TEXT,
    "status" "GiftSendStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "GiftSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OwnedGift" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "OwnedGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GiftItem_slug_key" ON "GiftItem"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftProduct_sku_key" ON "GiftProduct"("sku");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftProduct_appleProductId_key" ON "GiftProduct"("appleProductId");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftProduct_googleProductId_key" ON "GiftProduct"("googleProductId");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftProductItem_productId_itemId_key" ON "GiftProductItem"("productId", "itemId");
CREATE INDEX IF NOT EXISTS "GiftPurchase_buyerId_createdAt_idx" ON "GiftPurchase"("buyerId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftPurchase_provider_providerTxnId_key" ON "GiftPurchase"("provider", "providerTxnId");
CREATE UNIQUE INDEX IF NOT EXISTS "GiftSend_purchaseId_key" ON "GiftSend"("purchaseId");
CREATE INDEX IF NOT EXISTS "GiftSend_recipientId_createdAt_idx" ON "GiftSend"("recipientId", "createdAt");
CREATE INDEX IF NOT EXISTS "GiftSend_senderId_createdAt_idx" ON "GiftSend"("senderId", "createdAt");
CREATE INDEX IF NOT EXISTS "GiftSend_liveStreamId_deliveredAt_idx" ON "GiftSend"("liveStreamId", "deliveredAt");
CREATE INDEX IF NOT EXISTS "OwnedGift_ownerId_revokedAt_idx" ON "OwnedGift"("ownerId", "revokedAt");
CREATE INDEX IF NOT EXISTS "OwnedGift_sendId_idx" ON "OwnedGift"("sendId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_giftSendId_key" ON "Message"("giftSendId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_equippedFrameItemId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_equippedFrameItemId_fkey" FOREIGN KEY ("equippedFrameItemId") REFERENCES "GiftItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_equippedBadgeItemId_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_equippedBadgeItemId_fkey" FOREIGN KEY ("equippedBadgeItemId") REFERENCES "GiftItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_giftSendId_fkey') THEN
    ALTER TABLE "Message" ADD CONSTRAINT "Message_giftSendId_fkey" FOREIGN KEY ("giftSendId") REFERENCES "GiftSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftProductItem_productId_fkey') THEN
    ALTER TABLE "GiftProductItem" ADD CONSTRAINT "GiftProductItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GiftProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftProductItem_itemId_fkey') THEN
    ALTER TABLE "GiftProductItem" ADD CONSTRAINT "GiftProductItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "GiftItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- A purchase outlives its buyer's account (buyerId set null): it is the record of a payment.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftPurchase_buyerId_fkey') THEN
    ALTER TABLE "GiftPurchase" ADD CONSTRAINT "GiftPurchase_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftPurchase_productId_fkey') THEN
    ALTER TABLE "GiftPurchase" ADD CONSTRAINT "GiftPurchase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "GiftProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_purchaseId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "GiftPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- The sender's account going away leaves the gift with its recipient; the recipient's takes the gift with it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_senderId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_recipientId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_conversationId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GiftSend_liveStreamId_fkey') THEN
    ALTER TABLE "GiftSend" ADD CONSTRAINT "GiftSend_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OwnedGift_ownerId_fkey') THEN
    ALTER TABLE "OwnedGift" ADD CONSTRAINT "OwnedGift_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OwnedGift_itemId_fkey') THEN
    ALTER TABLE "OwnedGift" ADD CONSTRAINT "OwnedGift_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "GiftItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OwnedGift_sendId_fkey') THEN
    ALTER TABLE "OwnedGift" ADD CONSTRAINT "OwnedGift_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "GiftSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
