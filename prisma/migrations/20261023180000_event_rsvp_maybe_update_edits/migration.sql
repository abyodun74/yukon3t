-- Event replies get a status (Going / Maybe; every existing reply becomes Going through the column default) and a
-- Maybe count on the post; organizer updates can be edited and deleted. Generated with `prisma migrate diff` from the
-- previous schema.
-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('GOING', 'MAYBE');

-- DropIndex
DROP INDEX "PostRsvp_postId_idx";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "maybeCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PostRsvp" ADD COLUMN     "status" "RsvpStatus" NOT NULL DEFAULT 'GOING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "EventAnnouncement" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "PostRsvp_postId_status_idx" ON "PostRsvp"("postId", "status");

