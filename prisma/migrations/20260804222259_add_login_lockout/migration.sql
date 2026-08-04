-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_SENT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);
