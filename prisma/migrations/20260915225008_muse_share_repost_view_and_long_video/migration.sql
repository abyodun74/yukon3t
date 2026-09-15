-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MUSE_REPOST';
ALTER TYPE "NotificationType" ADD VALUE 'MUSE_SHARE';

-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "repostCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shareCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoLongReviewClaimedAt" TIMESTAMP(3),
ADD COLUMN     "videoStreamUid" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MuseShare" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "museId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuseShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuseRepost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "museId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuseRepost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MuseShare_museId_idx" ON "MuseShare"("museId");

-- CreateIndex
CREATE INDEX "MuseRepost_museId_idx" ON "MuseRepost"("museId");

-- CreateIndex
CREATE UNIQUE INDEX "MuseRepost_userId_museId_key" ON "MuseRepost"("userId", "museId");

-- CreateIndex
CREATE INDEX "Muse_moderationStatus_videoLongReviewClaimedAt_idx" ON "Muse"("moderationStatus", "videoLongReviewClaimedAt");

-- AddForeignKey
ALTER TABLE "MuseShare" ADD CONSTRAINT "MuseShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseShare" ADD CONSTRAINT "MuseShare_museId_fkey" FOREIGN KEY ("museId") REFERENCES "Muse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseRepost" ADD CONSTRAINT "MuseRepost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseRepost" ADD CONSTRAINT "MuseRepost_museId_fkey" FOREIGN KEY ("museId") REFERENCES "Muse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
