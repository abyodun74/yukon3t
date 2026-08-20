-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "videoModeratedAt" TIMESTAMP(3),
ADD COLUMN     "videoModerationTaskId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Post_mediaType_videoModeratedAt_idx" ON "Post"("mediaType", "videoModeratedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

