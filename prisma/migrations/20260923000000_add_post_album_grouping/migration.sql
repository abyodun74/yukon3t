-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "albumId" TEXT,
ADD COLUMN     "albumIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Post_albumId_albumIndex_idx" ON "Post"("albumId", "albumIndex");
