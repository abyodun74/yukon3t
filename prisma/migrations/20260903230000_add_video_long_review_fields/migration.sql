-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "videoDurationSeconds" INTEGER,
ADD COLUMN     "videoLongReviewClaimedAt" TIMESTAMP(3),
ADD COLUMN     "videoStreamUid" TEXT;

-- CreateIndex
CREATE INDEX "Post_mediaType_moderationStatus_videoLongReviewClaimedAt_idx" ON "Post"("mediaType", "moderationStatus", "videoLongReviewClaimedAt");
