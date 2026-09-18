-- CreateTable
CREATE TABLE "VoipPushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoipPushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoipPushToken_token_key" ON "VoipPushToken"("token");

-- CreateIndex
CREATE INDEX "VoipPushToken_userId_idx" ON "VoipPushToken"("userId");

-- AddForeignKey
ALTER TABLE "VoipPushToken" ADD CONSTRAINT "VoipPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
