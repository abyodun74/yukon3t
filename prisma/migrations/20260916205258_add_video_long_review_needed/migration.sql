-- DropIndex
DROP INDEX "Post_mediaType_moderationStatus_videoLongReviewClaimedAt_idx";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "videoLongReviewNeeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Post_mediaType_videoLongReviewNeeded_videoLongReviewClaimed_idx" ON "Post"("mediaType", "videoLongReviewNeeded", "videoLongReviewClaimedAt");

-- Backfill: any post already FLAGGED awaiting the long-video review
-- pipeline (mediaType VIDEO, over Hive's scan limit) needs
-- videoLongReviewNeeded = true, or it silently drops out of the
-- moderate-long-videos cron's candidate query forever, stuck hidden with
-- no path to a verdict — the new column's own default (false) would
-- otherwise widen this exact gap for every post already in flight.
UPDATE "Post"
SET "videoLongReviewNeeded" = true
WHERE "mediaType" = 'VIDEO'
  AND "moderationStatus" = 'FLAGGED'
  AND "videoDurationSeconds" IS NOT NULL
  AND "videoDurationSeconds" > 60;
