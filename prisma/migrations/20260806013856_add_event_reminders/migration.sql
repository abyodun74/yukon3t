-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_REMINDER';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "eventReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Post_eventAt_idx" ON "Post"("eventAt");
