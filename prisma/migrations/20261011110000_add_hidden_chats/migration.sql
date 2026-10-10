-- AlterEnum
ALTER TYPE "SecurityChallengePurpose" ADD VALUE 'HIDDEN_PIN_RESET';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hiddenChatsPinHash" TEXT,
ADD COLUMN     "hiddenPinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hiddenPinLockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ConversationMember_userId_hiddenAt_idx" ON "ConversationMember"("userId", "hiddenAt");
