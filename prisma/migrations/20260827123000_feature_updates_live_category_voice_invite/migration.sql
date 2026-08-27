-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'VOICE_CHANNEL_INVITE';
ALTER TYPE "NotificationType" ADD VALUE 'VOICE_CHANNEL_INVITE_ACCEPTED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "channelId" TEXT;

-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "lastHostActivityAt" TIMESTAMP(3);

-- AlterTable: Circle.category single string -> array (existing single
-- values become one-element arrays; no data loss).
DROP INDEX "Circle_category_idx";
ALTER TABLE "Circle" ALTER COLUMN "category" TYPE TEXT[] USING ARRAY["category"];
CREATE INDEX "Circle_category_idx" ON "Circle" USING GIN ("category");

-- CreateTable
CREATE TABLE "ChannelVoiceInvite" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelVoiceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelVoiceInvite_channelId_status_idx" ON "ChannelVoiceInvite"("channelId", "status");

-- CreateIndex
CREATE INDEX "ChannelVoiceInvite_inviteeId_status_idx" ON "ChannelVoiceInvite"("inviteeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelVoiceInvite_channelId_inviteeId_key" ON "ChannelVoiceInvite"("channelId", "inviteeId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVoiceInvite" ADD CONSTRAINT "ChannelVoiceInvite_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVoiceInvite" ADD CONSTRAINT "ChannelVoiceInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVoiceInvite" ADD CONSTRAINT "ChannelVoiceInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
