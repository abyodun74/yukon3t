-- Live stage invites (src/lib/live-stage.ts, actions/live-stream-invites.ts), step 2 of 2: the host or a co-host
-- invites people to come on stage. Additive only: one new enum and one new table, nothing existing is altered or
-- dropped. Hand-written to match what `prisma migrate diff` produces for the schema change (checked against
-- `--from-schema <previous schema> --to-schema prisma/schema.prisma`); it holds no DROP INDEX for the hand-written
-- HNSW indexes.

-- CreateEnum
CREATE TYPE "LiveStreamInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "LiveStreamInvite" (
    "id" TEXT NOT NULL,
    "liveStreamId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "LiveStreamInviteStatus" NOT NULL DEFAULT 'PENDING',
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "LiveStreamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveStreamInvite_liveStreamId_status_idx" ON "LiveStreamInvite"("liveStreamId", "status");

-- CreateIndex
CREATE INDEX "LiveStreamInvite_inviteeId_status_idx" ON "LiveStreamInvite"("inviteeId", "status");

-- CreateIndex
CREATE INDEX "LiveStreamInvite_invitedById_inviteeId_createdAt_idx" ON "LiveStreamInvite"("invitedById", "inviteeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStreamInvite_liveStreamId_inviteeId_key" ON "LiveStreamInvite"("liveStreamId", "inviteeId");

-- AddForeignKey
ALTER TABLE "LiveStreamInvite" ADD CONSTRAINT "LiveStreamInvite_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamInvite" ADD CONSTRAINT "LiveStreamInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamInvite" ADD CONSTRAINT "LiveStreamInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
