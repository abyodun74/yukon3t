-- Password sign-in lockout per (account or typed identifier) x (client IP or device), src/lib/login-lockout.ts.
-- Additive and idempotent: one new table, its unique key and an index. No foreign key on purpose (an identifier that
-- matches no account is counted too). Nothing to backfill: existing User.failedLoginAttempts/lockedUntil keep serving
-- as the account-wide counter.
--
-- PasswordResetToken.token now holds the SHA-256 of the emailed token (src/lib/reset-token.ts). No change is needed
-- here: rows written before this deploy hold a raw token, which never matches a hashed lookup, so those links stop
-- working (they expired within an hour anyway).

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoginFailureCounter" (
    "id" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginFailureCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoginFailureCounter_subjectKey_sourceKey_key" ON "LoginFailureCounter"("subjectKey", "sourceKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoginFailureCounter_updatedAt_idx" ON "LoginFailureCounter"("updatedAt");
