-- Circle event organizer tools: organizer updates (EventAnnouncement, EVENT_ANNOUNCEMENT), attendance check-in
-- (EventAttendance) and translating organizer updates (ContentTranslation.eventAnnouncementId). Generated with
-- `prisma migrate diff` from the previous schema; the CHECK constraint swap at the end was added by hand.
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EVENT_ANNOUNCEMENT';

-- AlterTable
ALTER TABLE "ContentTranslation" ADD COLUMN     "eventAnnouncementId" TEXT;

-- CreateTable
CREATE TABLE "EventAnnouncement" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendance" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walkIn" BOOLEAN NOT NULL DEFAULT false,
    "checkedInById" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventAnnouncement_postId_createdAt_idx" ON "EventAnnouncement"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "EventAnnouncement_authorId_idx" ON "EventAnnouncement"("authorId");

-- CreateIndex
CREATE INDEX "EventAttendance_userId_idx" ON "EventAttendance"("userId");

-- CreateIndex
CREATE INDEX "EventAttendance_checkedInById_idx" ON "EventAttendance"("checkedInById");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendance_postId_userId_key" ON "EventAttendance"("postId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_eventAnnouncementId_targetLang_contentHa_key" ON "ContentTranslation"("eventAnnouncementId", "targetLang", "contentHash");

-- AddForeignKey
ALTER TABLE "EventAnnouncement" ADD CONSTRAINT "EventAnnouncement_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAnnouncement" ADD CONSTRAINT "EventAnnouncement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_eventAnnouncementId_fkey" FOREIGN KEY ("eventAnnouncementId") REFERENCES "EventAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every row still belongs to exactly one post, comment, message or organizer update (each cascades with it).
ALTER TABLE "ContentTranslation" DROP CONSTRAINT "ContentTranslation_one_source_check";
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_one_source_check" CHECK (num_nonnulls("postId", "commentId", "messageId", "eventAnnouncementId") = 1);
