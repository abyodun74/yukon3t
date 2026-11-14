-- Muse comments: one level of threaded replies, likes on comments and replies, and a link from a Muse comment /
-- reply notification to the comment it is about (actions/muse-comments.ts, src/lib/muse-comment-threads.ts).
-- Hand-written from `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema.prisma --script`.
-- Additive only: two nullable columns, one new table, indexes and foreign keys. Existing comments stay top-level
-- (parentId NULL). Nothing is dropped, and no pgvector HNSW index is touched. No enum value is added (replies reuse
-- the existing COMMENT_REPLY notification type).

-- AlterTable
ALTER TABLE "MuseComment" ADD COLUMN "parentId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "museCommentId" TEXT;

-- CreateTable
CREATE TABLE "MuseCommentLike" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuseCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MuseComment_parentId_createdAt_idx" ON "MuseComment"("parentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_museCommentId_idx" ON "Notification"("museCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "MuseCommentLike_commentId_userId_key" ON "MuseCommentLike"("commentId", "userId");

-- CreateIndex
CREATE INDEX "MuseCommentLike_userId_idx" ON "MuseCommentLike"("userId");

-- AddForeignKey
ALTER TABLE "MuseComment" ADD CONSTRAINT "MuseComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MuseComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_museCommentId_fkey" FOREIGN KEY ("museCommentId") REFERENCES "MuseComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseCommentLike" ADD CONSTRAINT "MuseCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "MuseComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseCommentLike" ADD CONSTRAINT "MuseCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
