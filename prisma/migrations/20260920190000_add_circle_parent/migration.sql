-- AlterTable
ALTER TABLE "Circle" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Circle_parentId_idx" ON "Circle"("parentId");

-- AddForeignKey
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
