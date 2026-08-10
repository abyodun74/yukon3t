-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifyTypes" "NotificationType"[] DEFAULT ARRAY[]::"NotificationType"[],
ADD COLUMN     "emailOnMessages" BOOLEAN NOT NULL DEFAULT false;
