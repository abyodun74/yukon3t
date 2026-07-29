-- CreateEnum
CREATE TYPE "PostMediaType" AS ENUM ('NONE', 'IMAGE', 'VIDEO');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BAN';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'BANNED';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "mediaType" "PostMediaType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "videoThumbnailUrl" TEXT,
ADD COLUMN     "videoUrl" TEXT;
