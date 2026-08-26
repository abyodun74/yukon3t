-- CreateTable
CREATE TABLE "LiveStreamStageRequest" (
    "id" TEXT NOT NULL,
    "liveStreamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LiveStreamRole" NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "LiveStreamStageRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveStreamStageRequest_liveStreamId_status_idx" ON "LiveStreamStageRequest"("liveStreamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStreamStageRequest_liveStreamId_userId_key" ON "LiveStreamStageRequest"("liveStreamId", "userId");

-- AddForeignKey
ALTER TABLE "LiveStreamStageRequest" ADD CONSTRAINT "LiveStreamStageRequest_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamStageRequest" ADD CONSTRAINT "LiveStreamStageRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
