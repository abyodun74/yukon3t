-- AlterEnum
ALTER TYPE "AnalyticsEventType" ADD VALUE 'DEVICE_CHALLENGE_SENT';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'DEVICE_CHALLENGE_PASSED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'DEVICE_CHALLENGE_FAILED';
ALTER TYPE "AnalyticsEventType" ADD VALUE 'DEVICE_TRUSTED';

-- CreateEnum
CREATE TYPE "SecurityChallengePurpose" AS ENUM ('LOGIN', 'PASSWORD_CHANGE', 'POST');

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "SecurityChallengePurpose" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "newPasswordHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_userId_deviceId_key" ON "KnownDevice"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "KnownDevice_userId_idx" ON "KnownDevice"("userId");

-- CreateIndex
CREATE INDEX "SecurityChallenge_userId_purpose_idx" ON "SecurityChallenge"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityChallenge" ADD CONSTRAINT "SecurityChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
