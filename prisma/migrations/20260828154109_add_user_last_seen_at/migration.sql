-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_status_discoverable_lastSeenAt_idx" ON "User"("status", "discoverable", "lastSeenAt");
