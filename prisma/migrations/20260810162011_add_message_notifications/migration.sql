-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "conversationId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "emailNotifyTypes",
DROP COLUMN "emailOnMessages";

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
