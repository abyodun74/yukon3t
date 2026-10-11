-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetRequiredAt" TIMESTAMP(3);

-- Force a password reset for every account that already has a password (their hashes must be treated as exposed).
-- The App Store review demo account is left alone: reviewers cannot read its mailbox.
UPDATE "User" SET "passwordResetRequiredAt" = CURRENT_TIMESTAMP WHERE "passwordHash" IS NOT NULL AND "isAppReviewDemo" = false;
