-- AlterEnum
ALTER TYPE "StoryMediaType" ADD VALUE 'EMBED';

-- CreateEnum
CREATE TYPE "MuseMediaType" AS ENUM ('VIDEO', 'EMBED');

-- AlterTable
ALTER TABLE "Story" ALTER COLUMN "mediaUrl" DROP NOT NULL,
ADD COLUMN     "embedProvider" "EmbedProvider",
ADD COLUMN     "embedId" TEXT;

-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "mediaType" "MuseMediaType" NOT NULL DEFAULT 'VIDEO',
ADD COLUMN     "embedProvider" "EmbedProvider",
ADD COLUMN     "embedId" TEXT,
ALTER COLUMN "videoUrl" DROP NOT NULL,
ALTER COLUMN "videoDurationSeconds" DROP NOT NULL;
