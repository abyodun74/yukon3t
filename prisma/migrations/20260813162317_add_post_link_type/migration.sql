-- AlterEnum
ALTER TYPE "PostMediaType" ADD VALUE 'LINK';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "linkUrl" TEXT;
