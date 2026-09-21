-- CreateTable
CREATE TABLE "UploadRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "UploadRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadRecord_key_key" ON "UploadRecord"("key");

-- CreateIndex
CREATE INDEX "UploadRecord_createdAt_idx" ON "UploadRecord"("createdAt");

