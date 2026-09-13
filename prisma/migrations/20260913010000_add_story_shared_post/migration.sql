-- AlterTable
ALTER TABLE "Story" ADD COLUMN "sharedPostId" TEXT;

-- CreateIndex
CREATE INDEX "Story_sharedPostId_idx" ON "Story"("sharedPostId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
