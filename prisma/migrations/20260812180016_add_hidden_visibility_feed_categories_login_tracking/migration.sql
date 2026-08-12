-- CreateEnum
CREATE TYPE "FeedCategory" AS ENUM ('OCCUPATIONAL', 'ENTERTAINMENT', 'POLITICS', 'SPORTS', 'GENERAL');

-- AlterEnum
ALTER TYPE "PostsVisibility" ADD VALUE 'HIDDEN';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "feedCategory" "FeedCategory" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Post_feedCategory_moderationStatus_createdAt_idx" ON "Post"("feedCategory", "moderationStatus", "createdAt");
