ALTER TABLE "CollabBoardPost" ADD COLUMN "scheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "CollabBoardPost" ADD COLUMN "scheduleTime" TEXT;
ALTER TABLE "CollabBoardPost" ADD COLUMN "nextSessionAt" TIMESTAMP(3);
ALTER TABLE "CollabBoardPost" ADD COLUMN "sessionReminderSentAt" TIMESTAMP(3);

CREATE INDEX "CollabBoardPost_nextSessionAt_idx" ON "CollabBoardPost"("nextSessionAt");
