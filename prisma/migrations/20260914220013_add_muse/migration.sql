-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MUSE_LIKE';
ALTER TYPE "NotificationType" ADD VALUE 'MUSE_COMMENT';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "museId" TEXT;

-- CreateTable
CREATE TABLE "Muse" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "caption" TEXT,
    "videoUrl" TEXT NOT NULL,
    "videoThumbnailUrl" TEXT,
    "videoDurationSeconds" INTEGER NOT NULL,
    "videoModeratedAt" TIMESTAMP(3),
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Muse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuseReaction" (
    "id" TEXT NOT NULL,
    "museId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuseReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MuseComment" (
    "id" TEXT NOT NULL,
    "museId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuseComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Muse_authorId_idx" ON "Muse"("authorId");

-- CreateIndex
CREATE INDEX "Muse_moderationStatus_createdAt_idx" ON "Muse"("moderationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Muse_videoModeratedAt_idx" ON "Muse"("videoModeratedAt");

-- CreateIndex
CREATE INDEX "MuseReaction_museId_idx" ON "MuseReaction"("museId");

-- CreateIndex
CREATE UNIQUE INDEX "MuseReaction_museId_userId_key" ON "MuseReaction"("museId", "userId");

-- CreateIndex
CREATE INDEX "MuseComment_museId_createdAt_idx" ON "MuseComment"("museId", "createdAt");

-- CreateIndex
CREATE INDEX "MuseComment_authorId_idx" ON "MuseComment"("authorId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_museId_fkey" FOREIGN KEY ("museId") REFERENCES "Muse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Muse" ADD CONSTRAINT "Muse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseReaction" ADD CONSTRAINT "MuseReaction_museId_fkey" FOREIGN KEY ("museId") REFERENCES "Muse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseReaction" ADD CONSTRAINT "MuseReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseComment" ADD CONSTRAINT "MuseComment_museId_fkey" FOREIGN KEY ("museId") REFERENCES "Muse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuseComment" ADD CONSTRAINT "MuseComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
