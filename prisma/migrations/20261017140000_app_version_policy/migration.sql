-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'APP_VERSION_POLICY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'APP_UPDATE_NOTICE_SENT';

-- AlterTable
ALTER TABLE "FcmToken" ADD COLUMN     "appVersion" TEXT,
ADD COLUMN     "build" INTEGER,
ADD COLUMN     "platform" TEXT;

-- CreateTable
CREATE TABLE "AppVersionPolicy" (
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "latestBuild" INTEGER,
    "minBuild" INTEGER,
    "latestVersion" TEXT,
    "message" TEXT,
    "storeUrl" TEXT,
    "appStoreId" TEXT,
    "iosAutoDetect" BOOLEAN NOT NULL DEFAULT true,
    "lastNotifiedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppVersionPolicy_pkey" PRIMARY KEY ("platform")
);

-- CreateIndex
CREATE INDEX "FcmToken_platform_build_idx" ON "FcmToken"("platform", "build");

