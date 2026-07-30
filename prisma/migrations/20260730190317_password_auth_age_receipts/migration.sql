-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "birthDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
