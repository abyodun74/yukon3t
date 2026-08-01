-- CreateTable
CREATE TABLE "MessageCorrection" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "correctedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageCorrection_messageId_idx" ON "MessageCorrection"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageCorrection_messageId_authorId_key" ON "MessageCorrection"("messageId", "authorId");

-- AddForeignKey
ALTER TABLE "MessageCorrection" ADD CONSTRAINT "MessageCorrection_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCorrection" ADD CONSTRAINT "MessageCorrection_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
