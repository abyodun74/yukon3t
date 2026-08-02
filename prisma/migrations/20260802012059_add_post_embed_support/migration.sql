-- CreateEnum
CREATE TYPE "EmbedProvider" AS ENUM ('YOUTUBE', 'VIMEO');

-- AlterEnum
ALTER TYPE "PostMediaType" ADD VALUE 'EMBED';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "embedId" TEXT,
ADD COLUMN     "embedProvider" "EmbedProvider";
