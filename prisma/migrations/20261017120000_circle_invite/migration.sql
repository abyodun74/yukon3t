-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CIRCLE_INVITE';
ALTER TYPE "NotificationType" ADD VALUE 'CIRCLE_INVITE_ACCEPTED';

-- CreateTable
CREATE TABLE "CircleInvite" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CircleInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CircleInvite_circleId_status_idx" ON "CircleInvite"("circleId", "status");

-- CreateIndex
CREATE INDEX "CircleInvite_inviteeId_status_idx" ON "CircleInvite"("inviteeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CircleInvite_circleId_inviteeId_key" ON "CircleInvite"("circleId", "inviteeId");

-- AddForeignKey
ALTER TABLE "CircleInvite" ADD CONSTRAINT "CircleInvite_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleInvite" ADD CONSTRAINT "CircleInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleInvite" ADD CONSTRAINT "CircleInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

