-- AlterEnum
ALTER TYPE "MessageMediaType" ADD VALUE 'GIF';

-- AlterEnum
ALTER TYPE "PostMediaType" ADD VALUE 'GIF';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "gifUrl" TEXT;
