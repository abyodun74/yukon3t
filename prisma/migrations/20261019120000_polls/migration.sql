-- CreateEnum
CREATE TYPE "PollKind" AS ENUM ('GENERAL', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'POLL_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'POLL_SCHEDULED';

-- AlterTable
ALTER TABLE "CollabBoardPost" ADD COLUMN     "oneOffReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "oneOffSessionAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "circleId" TEXT,
    "channelId" TEXT,
    "collabId" TEXT,
    "createdById" TEXT NOT NULL,
    "kind" "PollKind" NOT NULL DEFAULT 'GENERAL',
    "question" TEXT NOT NULL,
    "description" TEXT,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "closesAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "scheduledOptionId" TEXT,
    "scheduledPostId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT,
    "startsAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Poll_circleId_createdAt_idx" ON "Poll"("circleId", "createdAt");

-- CreateIndex
CREATE INDEX "Poll_collabId_createdAt_idx" ON "Poll"("collabId", "createdAt");

-- CreateIndex
CREATE INDEX "Poll_channelId_idx" ON "Poll"("channelId");

-- CreateIndex
CREATE INDEX "Poll_createdById_idx" ON "Poll"("createdById");

-- CreateIndex
CREATE INDEX "Poll_scheduledPostId_idx" ON "Poll"("scheduledPostId");

-- CreateIndex
CREATE INDEX "PollOption_pollId_position_idx" ON "PollOption"("pollId", "position");

-- CreateIndex
CREATE INDEX "PollVote_pollId_userId_idx" ON "PollVote"("pollId", "userId");

-- CreateIndex
CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");

-- CreateIndex
CREATE INDEX "PollVote_userId_idx" ON "PollVote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_optionId_userId_key" ON "PollVote"("pollId", "optionId", "userId");

-- CreateIndex
CREATE INDEX "CollabBoardPost_oneOffSessionAt_idx" ON "CollabBoardPost"("oneOffSessionAt");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_scheduledPostId_fkey" FOREIGN KEY ("scheduledPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (Prisma's schema can't express these, and doesn't diff CHECK constraints): a poll has exactly one
-- parent, a Circle or a collab, and a channel only ever narrows a Circle poll. actions/polls.ts enforces the same
-- (pollParentError in src/lib/polls.ts); this is the backstop.
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_exactly_one_parent" CHECK (("circleId" IS NULL) <> ("collabId" IS NULL));
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_channel_needs_circle" CHECK ("channelId" IS NULL OR "circleId" IS NOT NULL);
