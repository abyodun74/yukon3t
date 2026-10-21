-- CreateEnum
CREATE TYPE "EventRepeatFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_RSVP_NUDGE';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "eventNudgedAt" TIMESTAMP(3),
ADD COLUMN     "eventSeriesId" TEXT,
ADD COLUMN     "eventSeriesIndex" INTEGER;

-- CreateTable
CREATE TABLE "EventBringItem" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventBringItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "frequency" "EventRepeatFrequency" NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "maxOccurrences" INTEGER NOT NULL,
    "until" TIMESTAMP(3),
    "content" TEXT NOT NULL,
    "eventLocation" TEXT,
    "feedCategory" "FeedCategory" NOT NULL DEFAULT 'GENERAL',
    "lastIndex" INTEGER NOT NULL DEFAULT 0,
    "lastOccurrenceAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventBringItem_postId_position_idx" ON "EventBringItem"("postId", "position");

-- CreateIndex
CREATE INDEX "EventBringItem_claimedById_idx" ON "EventBringItem"("claimedById");

-- CreateIndex
CREATE INDEX "EventSeries_endedAt_lastOccurrenceAt_idx" ON "EventSeries"("endedAt", "lastOccurrenceAt");

-- CreateIndex
CREATE INDEX "EventSeries_circleId_idx" ON "EventSeries"("circleId");

-- CreateIndex
CREATE INDEX "EventSeries_channelId_idx" ON "EventSeries"("channelId");

-- CreateIndex
CREATE INDEX "EventSeries_authorId_idx" ON "EventSeries"("authorId");

-- CreateIndex
CREATE INDEX "Post_circleId_eventAt_idx" ON "Post"("circleId", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_eventSeriesId_eventSeriesIndex_key" ON "Post"("eventSeriesId", "eventSeriesIndex");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBringItem" ADD CONSTRAINT "EventBringItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBringItem" ADD CONSTRAINT "EventBringItem_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
