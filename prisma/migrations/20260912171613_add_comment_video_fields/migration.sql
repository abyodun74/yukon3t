-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "videoDurationSeconds" INTEGER,
ADD COLUMN     "videoLongReviewClaimedAt" TIMESTAMP(3),
ADD COLUMN     "videoModeratedAt" TIMESTAMP(3),
ADD COLUMN     "videoStreamUid" TEXT,
ADD COLUMN     "videoThumbnailUrl" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- CreateIndex
CREATE INDEX "Comment_videoModeratedAt_idx" ON "Comment"("videoModeratedAt");

-- CreateIndex
CREATE INDEX "Comment_moderationStatus_videoLongReviewClaimedAt_idx" ON "Comment"("moderationStatus", "videoLongReviewClaimedAt");
