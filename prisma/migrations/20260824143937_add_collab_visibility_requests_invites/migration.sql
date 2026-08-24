-- CreateEnum
CREATE TYPE "CollabVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'COLLAB_JOIN_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'COLLAB_JOIN_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'COLLAB_INVITE';
ALTER TYPE "NotificationType" ADD VALUE 'COLLAB_INVITE_ACCEPTED';

-- AlterTable
ALTER TABLE "CollabBoardPost" ADD COLUMN     "visibility" "CollabVisibility" NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE "CollabJoinRequest" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CollabJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabInvite" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CollabInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollabJoinRequest_collabId_status_idx" ON "CollabJoinRequest"("collabId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollabJoinRequest_collabId_userId_key" ON "CollabJoinRequest"("collabId", "userId");

-- CreateIndex
CREATE INDEX "CollabInvite_collabId_status_idx" ON "CollabInvite"("collabId", "status");

-- CreateIndex
CREATE INDEX "CollabInvite_inviteeId_status_idx" ON "CollabInvite"("inviteeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CollabInvite_collabId_inviteeId_key" ON "CollabInvite"("collabId", "inviteeId");

-- CreateIndex
CREATE INDEX "CollabBoardPost_visibility_idx" ON "CollabBoardPost"("visibility");

-- AddForeignKey
ALTER TABLE "CollabJoinRequest" ADD CONSTRAINT "CollabJoinRequest_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabJoinRequest" ADD CONSTRAINT "CollabJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabInvite" ADD CONSTRAINT "CollabInvite_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabInvite" ADD CONSTRAINT "CollabInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabInvite" ADD CONSTRAINT "CollabInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
