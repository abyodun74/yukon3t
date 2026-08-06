-- CreateEnum
CREATE TYPE "CollabRole" AS ENUM ('PARTICIPANT', 'MODERATOR', 'OWNER');

-- AlterTable
ALTER TABLE "CollabBoardPost" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "roomName" TEXT,
ADD COLUMN     "roomUrl" TEXT;

-- CreateTable
CREATE TABLE "CollabParticipant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "role" "CollabRole" NOT NULL DEFAULT 'PARTICIPANT',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabSessionParticipant" (
    "id" TEXT NOT NULL,
    "collabId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabSessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollabParticipant_collabId_role_idx" ON "CollabParticipant"("collabId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "CollabParticipant_userId_collabId_key" ON "CollabParticipant"("userId", "collabId");

-- CreateIndex
CREATE INDEX "CollabSessionParticipant_collabId_idx" ON "CollabSessionParticipant"("collabId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabSessionParticipant_collabId_userId_key" ON "CollabSessionParticipant"("collabId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollabBoardPost_conversationId_key" ON "CollabBoardPost"("conversationId");

-- AddForeignKey
ALTER TABLE "CollabBoardPost" ADD CONSTRAINT "CollabBoardPost_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabParticipant" ADD CONSTRAINT "CollabParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabParticipant" ADD CONSTRAINT "CollabParticipant_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabSessionParticipant" ADD CONSTRAINT "CollabSessionParticipant_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollabSessionParticipant" ADD CONSTRAINT "CollabSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

