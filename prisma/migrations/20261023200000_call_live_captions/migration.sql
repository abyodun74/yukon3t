-- Live translated captions for 1:1 calls (src/lib/call-captions.ts). Holds the two per-call agreements, open
-- transcription sessions (ids and times only) and a per-user monthly count of seconds. No audio or text is stored.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "captionsCalleeConsentAt" TIMESTAMP(3),
ADD COLUMN     "captionsCallerConsentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CallCaptionSession" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerCallId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CallCaptionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallCaptionUsage" (
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallCaptionUsage_pkey" PRIMARY KEY ("userId","month")
);

-- CreateIndex
CREATE INDEX "CallCaptionSession_callId_endedAt_idx" ON "CallCaptionSession"("callId", "endedAt");

-- CreateIndex
CREATE INDEX "CallCaptionSession_userId_endedAt_idx" ON "CallCaptionSession"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "CallCaptionSession_endedAt_leaseUntil_idx" ON "CallCaptionSession"("endedAt", "leaseUntil");

-- AddForeignKey
ALTER TABLE "CallCaptionSession" ADD CONSTRAINT "CallCaptionSession_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCaptionSession" ADD CONSTRAINT "CallCaptionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallCaptionUsage" ADD CONSTRAINT "CallCaptionUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

