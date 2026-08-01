-- AlterTable
ALTER TABLE "Circle" ADD COLUMN     "voiceRoomName" TEXT,
ADD COLUMN     "voiceRoomUrl" TEXT;

-- CreateTable
CREATE TABLE "CircleVoiceParticipant" (
    "id" TEXT NOT NULL,
    "circleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CircleVoiceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CircleVoiceParticipant_circleId_idx" ON "CircleVoiceParticipant"("circleId");

-- CreateIndex
CREATE UNIQUE INDEX "CircleVoiceParticipant_circleId_userId_key" ON "CircleVoiceParticipant"("circleId", "userId");

-- AddForeignKey
ALTER TABLE "CircleVoiceParticipant" ADD CONSTRAINT "CircleVoiceParticipant_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleVoiceParticipant" ADD CONSTRAINT "CircleVoiceParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
