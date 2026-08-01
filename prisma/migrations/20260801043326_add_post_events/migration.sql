-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_RSVP';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "eventAt" TIMESTAMP(3),
ADD COLUMN     "eventLocation" TEXT,
ADD COLUMN     "rsvpCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PostRsvp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostRsvp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostRsvp_postId_idx" ON "PostRsvp"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostRsvp_userId_postId_key" ON "PostRsvp"("userId", "postId");

-- AddForeignKey
ALTER TABLE "PostRsvp" ADD CONSTRAINT "PostRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostRsvp" ADD CONSTRAINT "PostRsvp_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
