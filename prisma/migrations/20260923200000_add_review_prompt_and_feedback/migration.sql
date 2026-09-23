-- CreateEnum
CREATE TYPE "ReviewPromptStatus" AS ENUM ('PENDING', 'LOVED', 'DECLINED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'APP_FEEDBACK_SUBMITTED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "reviewPromptStatus" "ReviewPromptStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewPromptAskCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewPromptLastAskedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AppFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppFeedback_userId_idx" ON "AppFeedback"("userId");

-- CreateIndex
CREATE INDEX "AppFeedback_createdAt_idx" ON "AppFeedback"("createdAt");

-- AddForeignKey
ALTER TABLE "AppFeedback" ADD CONSTRAINT "AppFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
