-- DropForeignKey
ALTER TABLE "Circle" DROP CONSTRAINT "Circle_createdById_fkey";

-- AddForeignKey
ALTER TABLE "Circle" ADD CONSTRAINT "Circle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
