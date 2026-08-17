-- CreateEnum
CREATE TYPE "LiveStreamStatus" AS ENUM ('LIVE', 'ENDED');

-- DropIndex
DROP INDEX "Conversation_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "sharedPostId" TEXT;

-- CreateTable
CREATE TABLE "LiveStream" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "circleId" TEXT,
    "title" TEXT NOT NULL,
    "status" "LiveStreamStatus" NOT NULL DEFAULT 'LIVE',
    "roomName" TEXT NOT NULL,
    "roomUrl" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveStreamViewer" (
    "id" TEXT NOT NULL,
    "liveStreamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveStreamViewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveStream_status_idx" ON "LiveStream"("status");

-- CreateIndex
CREATE INDEX "LiveStream_hostId_idx" ON "LiveStream"("hostId");

-- CreateIndex
CREATE INDEX "LiveStreamViewer_liveStreamId_idx" ON "LiveStreamViewer"("liveStreamId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStreamViewer_liveStreamId_userId_key" ON "LiveStreamViewer"("liveStreamId", "userId");

-- CreateIndex
CREATE INDEX "Post_sharedPostId_idx" ON "Post"("sharedPostId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_sharedPostId_fkey" FOREIGN KEY ("sharedPostId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamViewer" ADD CONSTRAINT "LiveStreamViewer_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStreamViewer" ADD CONSTRAINT "LiveStreamViewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
