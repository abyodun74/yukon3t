-- The moderate-long-videos cron (every minute) selects videoLongReviewNeeded = true ORDER BY createdAt on Comment and
-- Muse; neither table had an index leading with that column, so each run was a sequential scan. Additive only.

-- CreateIndex
CREATE INDEX "Comment_videoLongReviewNeeded_createdAt_idx" ON "Comment"("videoLongReviewNeeded", "createdAt");

-- CreateIndex
CREATE INDEX "Muse_videoLongReviewNeeded_createdAt_idx" ON "Muse"("videoLongReviewNeeded", "createdAt");
