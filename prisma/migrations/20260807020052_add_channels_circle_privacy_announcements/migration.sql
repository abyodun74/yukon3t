/*
  Warnings:

  - You are about to drop the column `voiceRoomName` on the `Circle` table. All the data in the column will be lost.
  - You are about to drop the column `voiceRoomUrl` on the `Circle` table. All the data in the column will be lost.
  - You are about to drop the `CircleVoiceParticipant` table. If the table is not empty, all the data it contains will be lost.

  NOTE: this file was hand-reordered from what `prisma migrate dev` generated.
  The generator drops Circle.voiceRoomName/voiceRoomUrl and the
  CircleVoiceParticipant table before the new Channel table exists, which
  would destroy the very data this migration needs to backfill into Channel
  rows. This version creates every new table/column first, backfills from
  the old columns/table, and only drops them at the very end.
*/

-- CreateEnum
CREATE TYPE "CircleVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'VOICE');

-- CreateEnum
CREATE TYPE "ChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CIRCLE_JOIN_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'CIRCLE_JOIN_APPROVED';

-- AlterTable: add the new Circle column, but do NOT drop the old voice-room
-- columns yet — the backfill below still needs to read them.
ALTER TABLE "Circle" ADD COLUMN     "visibility" "CircleVisibility" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "channelId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAnnouncementAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CircleJoinRequest" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CircleJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "topic" TEXT,
    "type" "ChannelType" NOT NULL,
    "visibility" "ChannelVisibility" NOT NULL DEFAULT 'PUBLIC',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voiceRoomName" TEXT,
    "voiceRoomUrl" TEXT,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMembership" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelVoiceParticipant" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelVoiceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CircleJoinRequest_circleId_status_idx" ON "CircleJoinRequest"("circleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CircleJoinRequest_circleId_userId_key" ON "CircleJoinRequest"("circleId", "userId");

-- CreateIndex
CREATE INDEX "Channel_circleId_position_idx" ON "Channel"("circleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_circleId_slug_key" ON "Channel"("circleId", "slug");

-- CreateIndex
CREATE INDEX "ChannelMembership_channelId_idx" ON "ChannelMembership"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMembership_channelId_userId_key" ON "ChannelMembership"("channelId", "userId");

-- CreateIndex
CREATE INDEX "ChannelVoiceParticipant_channelId_idx" ON "ChannelVoiceParticipant"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelVoiceParticipant_channelId_userId_key" ON "ChannelVoiceParticipant"("channelId", "userId");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- CreateIndex
CREATE INDEX "Post_channelId_moderationStatus_createdAt_idx" ON "Post"("channelId", "moderationStatus", "createdAt");

-- AddForeignKey
ALTER TABLE "CircleJoinRequest" ADD CONSTRAINT "CircleJoinRequest_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleJoinRequest" ADD CONSTRAINT "CircleJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMembership" ADD CONSTRAINT "ChannelMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVoiceParticipant" ADD CONSTRAINT "ChannelVoiceParticipant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelVoiceParticipant" ADD CONSTRAINT "ChannelVoiceParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataBackfill: every existing Circle gets a default "General" TEXT channel,
-- matching what createCircle will do for every new Circle going forward.
-- gen_random_uuid() needs pgcrypto — id format doesn't need to match cuid(),
-- FKs only care that values match, not their shape.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "Channel" ("id", "circleId", "name", "slug", "type", "visibility", "position", "createdById", "createdAt")
SELECT gen_random_uuid()::text, c."id", 'General', 'general', 'TEXT', 'PUBLIC', 0, c."createdById", c."createdAt"
FROM "Circle" c;

-- DataBackfill: any Circle that already had a persistent voice room gets a
-- "Voice" channel carrying that room's identity across, instead of losing it.
INSERT INTO "Channel" ("id", "circleId", "name", "slug", "type", "visibility", "position", "createdById", "createdAt", "voiceRoomName", "voiceRoomUrl")
SELECT gen_random_uuid()::text, c."id", 'Voice', 'voice', 'VOICE', 'PUBLIC', 1, c."createdById", c."createdAt", c."voiceRoomName", c."voiceRoomUrl"
FROM "Circle" c
WHERE c."voiceRoomName" IS NOT NULL AND c."voiceRoomUrl" IS NOT NULL;

-- DataBackfill: every existing Circle post moves into that circle's new
-- General channel — circleId itself is untouched.
UPDATE "Post" p
SET "channelId" = ch."id"
FROM "Channel" ch
WHERE ch."circleId" = p."circleId" AND ch."slug" = 'general' AND p."circleId" IS NOT NULL;

-- DataBackfill: carry live voice-room presence rows across to the new
-- per-channel table (only matches where a Voice channel was just created
-- above, i.e. the circle actually had a room).
INSERT INTO "ChannelVoiceParticipant" ("id", "channelId", "userId", "joinedAt")
SELECT gen_random_uuid()::text, ch."id", cvp."userId", cvp."joinedAt"
FROM "CircleVoiceParticipant" cvp
JOIN "Channel" ch ON ch."circleId" = cvp."circleId" AND ch."slug" = 'voice';

-- DropForeignKey
ALTER TABLE "CircleVoiceParticipant" DROP CONSTRAINT "CircleVoiceParticipant_circleId_fkey";

-- DropForeignKey
ALTER TABLE "CircleVoiceParticipant" DROP CONSTRAINT "CircleVoiceParticipant_userId_fkey";

-- DropTable: fully replaced by ChannelVoiceParticipant, backfilled above.
DROP TABLE "CircleVoiceParticipant";

-- AlterTable: the old single-room columns are fully replaced by Channel.voiceRoomName/voiceRoomUrl, backfilled above.
ALTER TABLE "Circle" DROP COLUMN "voiceRoomName",
DROP COLUMN "voiceRoomUrl";
