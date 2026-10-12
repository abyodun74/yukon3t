-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Comment_moderationStatus_createdAt_idx" ON "Comment"("moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Message_moderationStatus_createdAt_idx" ON "Message"("moderationStatus", "createdAt");
