-- CreateEnum
CREATE TYPE "AnnouncementMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "mediaType" "AnnouncementMediaType",
ADD COLUMN     "mediaUrl" TEXT,
ADD COLUMN     "mediaThumbnailUrl" TEXT;
