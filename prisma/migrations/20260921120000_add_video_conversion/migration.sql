-- CreateEnum
CREATE TYPE "VideoConversionStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "VideoConversion" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "VideoConversionStatus" NOT NULL DEFAULT 'PENDING',
    "streamUid" TEXT,
    "outputUrl" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VideoConversion_sourceUrl_key" ON "VideoConversion"("sourceUrl");

-- CreateIndex
CREATE INDEX "VideoConversion_status_createdAt_idx" ON "VideoConversion"("status", "createdAt");

