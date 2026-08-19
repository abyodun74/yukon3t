-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_REPOST';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_LIVE';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RSVP';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CIRCLE_JOINED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CIRCLE_CREATED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "liveStreamId" TEXT;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
