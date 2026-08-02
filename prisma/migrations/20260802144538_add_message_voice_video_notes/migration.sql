-- CreateEnum
CREATE TYPE "MessageMediaType" AS ENUM ('NONE', 'AUDIO', 'VIDEO');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mediaThumbnailUrl" TEXT,
ADD COLUMN     "mediaType" "MessageMediaType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "mediaUrl" TEXT;
