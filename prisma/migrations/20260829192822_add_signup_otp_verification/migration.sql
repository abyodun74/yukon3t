-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailOtpCodeHash" TEXT,
ADD COLUMN     "emailOtpExpires" TIMESTAMP(3),
ADD COLUMN     "pendingVerificationMethod" TEXT;
