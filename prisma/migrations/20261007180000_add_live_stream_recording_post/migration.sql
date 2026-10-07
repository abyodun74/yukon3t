-- CreateEnum
CREATE TYPE "LiveStreamRecordingPostStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "LiveStreamRecordingPost" (
    "id" TEXT NOT NULL,
    "liveStreamId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "circleId" TEXT,
    "status" "LiveStreamRecordingPostStatus" NOT NULL DEFAULT 'PENDING',
    "r2VideoUrl" TEXT,
    "videoDurationSeconds" INTEGER,
    "thumbnailUrl" TEXT,
    "streamUid" TEXT,
    "claimedAt" TIMESTAMP(3),
    "postId" TEXT,
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveStreamRecordingPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveStreamRecordingPost_recordingId_key" ON "LiveStreamRecordingPost"("recordingId");

-- CreateIndex
CREATE INDEX "LiveStreamRecordingPost_status_claimedAt_idx" ON "LiveStreamRecordingPost"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "LiveStreamRecordingPost_liveStreamId_idx" ON "LiveStreamRecordingPost"("liveStreamId");

-- AddForeignKey
ALTER TABLE "LiveStreamRecordingPost" ADD CONSTRAINT "LiveStreamRecordingPost_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
