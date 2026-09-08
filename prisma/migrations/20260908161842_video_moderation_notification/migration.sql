-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VIDEO_MODERATION_FAILED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "message" TEXT;
