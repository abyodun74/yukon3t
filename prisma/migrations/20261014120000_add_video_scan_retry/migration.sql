-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "videoScanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoScanRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "videoScanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoScanRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "videoScanAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoScanRetryAt" TIMESTAMP(3);
