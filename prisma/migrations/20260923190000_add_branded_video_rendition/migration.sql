-- CreateEnum
CREATE TYPE "BrandedVideoStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "BrandedVideoRendition" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "BrandedVideoStatus" NOT NULL DEFAULT 'PENDING',
    "streamUid" TEXT,
    "outputUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandedVideoRendition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandedVideoRendition_sourceUrl_key" ON "BrandedVideoRendition"("sourceUrl");

-- CreateIndex
CREATE INDEX "BrandedVideoRendition_status_createdAt_idx" ON "BrandedVideoRendition"("status", "createdAt");
