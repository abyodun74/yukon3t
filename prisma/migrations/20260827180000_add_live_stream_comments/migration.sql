-- CreateTable
CREATE TABLE "LiveStreamComment" (
    "id" TEXT NOT NULL,
    "liveStreamId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStreamComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveStreamComment_liveStreamId_createdAt_idx" ON "LiveStreamComment"("liveStreamId", "createdAt");

-- AddForeignKey
ALTER TABLE "LiveStreamComment" ADD CONSTRAINT "LiveStreamComment_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamComment" ADD CONSTRAINT "LiveStreamComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
