-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "viewOnce" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "viewOnceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "viewOnceOpenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ViewOnceMedia" (
    "messageId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewOnceMedia_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "Message_viewOnce_viewOnceOpenedAt_idx" ON "Message"("viewOnce", "viewOnceOpenedAt");

-- AddForeignKey
ALTER TABLE "ViewOnceMedia" ADD CONSTRAINT "ViewOnceMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
