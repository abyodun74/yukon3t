-- CreateIndex
CREATE INDEX "Post_circleId_moderationStatus_createdAt_idx" ON "Post"("circleId", "moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Post_authorId_moderationStatus_createdAt_idx" ON "Post"("authorId", "moderationStatus", "createdAt");
