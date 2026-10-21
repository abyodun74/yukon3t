-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'EVENT_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_RESCHEDULED';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "eventCancelReason" TEXT,
ADD COLUMN     "eventCancelledAt" TIMESTAMP(3),
ADD COLUMN     "eventPreviousAt" TIMESTAMP(3),
ADD COLUMN     "eventRescheduleReason" TEXT,
ADD COLUMN     "eventRescheduledAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Post_authorId_clientRequestId_key" ON "Post"("authorId", "clientRequestId");

