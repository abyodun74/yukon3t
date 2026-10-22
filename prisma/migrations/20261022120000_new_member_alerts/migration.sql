-- "New on YuKon3t" alerts (src/lib/new-member-alerts.ts). Generated with `prisma migrate diff` from the previous
-- schema, then the backfill below added by hand.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NEW_MEMBER_JOINED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "newMemberAlerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "newMemberAnnouncedAt" TIMESTAMP(3),
ADD COLUMN     "newMemberPushAt" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_onboardedAt_idx" ON "User"("onboardedAt");

-- Backfill: every profile already complete (the isProfileComplete rule in src/lib/page-guards.ts) counts as onboarded
-- when the account was created, and as already announced, so shipping this never announces an existing member.
-- Accounts that haven't finished onboarding yet are left alone and are announced when they do.
UPDATE "User"
SET "onboardedAt" = "createdAt",
    "newMemberAnnouncedAt" = NOW()
WHERE "name" IS NOT NULL
  AND "country" IS NOT NULL
  AND cardinality("interests") > 0;
