-- AlterTable
ALTER TABLE "ConversationMember" ADD COLUMN     "e2eeEnabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "evidenceText" TEXT;

-- CreateTable
CREATE TABLE "UserEncryptionKey" (
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "wrappedPrivateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEncryptionKey_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserEncryptionKey" ADD CONSTRAINT "UserEncryptionKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
