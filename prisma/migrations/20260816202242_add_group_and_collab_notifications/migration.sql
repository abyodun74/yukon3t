-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GROUP_ADDED';
ALTER TYPE "NotificationType" ADD VALUE 'COLLAB_JOINED';

-- Prisma's diff engine doesn't know about Conversation_embedding_hnsw_idx
-- (hand-written in 20260816183021_add_conversation_embedding — vector
-- indexes can't be expressed in schema.prisma) and generated a spurious
-- "DROP INDEX" for it here, same blind spot noted in that migration's own
-- comment. Deliberately not dropping it.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "collabId" TEXT;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_collabId_fkey" FOREIGN KEY ("collabId") REFERENCES "CollabBoardPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
