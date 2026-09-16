-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "sharedPostId" TEXT;

-- CreateIndex
CREATE INDEX "Muse_sharedPostId_idx" ON "Muse"("sharedPostId");

-- AddForeignKey
ALTER TABLE "Muse" ADD CONSTRAINT "Muse_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
