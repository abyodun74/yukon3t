-- CreateIndex
CREATE INDEX "User_status_discoverable_createdAt_idx" ON "User"("status", "discoverable", "createdAt");

-- CreateIndex
CREATE INDEX "Post_moderationStatus_createdAt_idx" ON "Post"("moderationStatus", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_videoUrl_idx" ON "Post"("videoUrl");

-- CreateIndex
CREATE INDEX "Post_videoThumbnailUrl_idx" ON "Post"("videoThumbnailUrl");

-- CreateIndex
CREATE INDEX "Post_mediaUrls_idx" ON "Post" USING GIN ("mediaUrls");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX "Comment_videoUrl_idx" ON "Comment"("videoUrl");

-- CreateIndex
CREATE INDEX "Comment_videoThumbnailUrl_idx" ON "Comment"("videoThumbnailUrl");

-- CreateIndex
CREATE INDEX "Comment_audioUrl_idx" ON "Comment"("audioUrl");

-- CreateIndex
CREATE INDEX "CommentReaction_userId_idx" ON "CommentReaction"("userId");

-- CreateIndex
CREATE INDEX "PostReaction_userId_idx" ON "PostReaction"("userId");

-- CreateIndex
CREATE INDEX "Share_userId_idx" ON "Share"("userId");

-- CreateIndex
CREATE INDEX "Notification_postId_idx" ON "Notification"("postId");

-- CreateIndex
CREATE INDEX "Notification_commentId_idx" ON "Notification"("commentId");

-- CreateIndex
CREATE INDEX "Notification_storyId_idx" ON "Notification"("storyId");

-- CreateIndex
CREATE INDEX "Notification_subscriptionId_idx" ON "Notification"("subscriptionId");

-- CreateIndex
CREATE INDEX "Notification_connectionId_idx" ON "Notification"("connectionId");

-- CreateIndex
CREATE INDEX "Notification_actorId_idx" ON "Notification"("actorId");

-- CreateIndex
CREATE INDEX "Notification_museId_idx" ON "Notification"("museId");

-- CreateIndex
CREATE INDEX "CollabBoardPost_authorId_idx" ON "CollabBoardPost"("authorId");

-- CreateIndex
CREATE INDEX "Story_mediaUrl_idx" ON "Story"("mediaUrl");

-- CreateIndex
CREATE INDEX "Story_mediaThumbnailUrl_idx" ON "Story"("mediaThumbnailUrl");

-- CreateIndex
CREATE INDEX "StoryReaction_userId_idx" ON "StoryReaction"("userId");

-- CreateIndex
CREATE INDEX "StoryView_viewerId_idx" ON "StoryView"("viewerId");

-- CreateIndex
CREATE INDEX "Muse_videoUrl_idx" ON "Muse"("videoUrl");

-- CreateIndex
CREATE INDEX "Muse_videoThumbnailUrl_idx" ON "Muse"("videoThumbnailUrl");

-- CreateIndex
CREATE INDEX "Muse_audioUrl_idx" ON "Muse"("audioUrl");

-- CreateIndex
CREATE INDEX "MuseReaction_userId_idx" ON "MuseReaction"("userId");

-- CreateIndex
CREATE INDEX "Connection_targetId_status_idx" ON "Connection"("targetId", "status");

-- CreateIndex
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_storyId_idx" ON "Message"("storyId");

-- CreateIndex
CREATE INDEX "Message_mediaUrl_idx" ON "Message"("mediaUrl");

-- CreateIndex
CREATE INDEX "Message_mediaThumbnailUrl_idx" ON "Message"("mediaThumbnailUrl");

-- CreateIndex
CREATE INDEX "MessageReaction_userId_idx" ON "MessageReaction"("userId");

-- CreateIndex
CREATE INDEX "Report_reportedUserId_status_idx" ON "Report"("reportedUserId", "status");

