-- CreateTable
CREATE TABLE "InnerCircleMember" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InnerCircleMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbientMoment" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "caption" TEXT,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbientMoment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbientWidgetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AmbientWidgetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InnerCircleMember_ownerId_memberId_key" ON "InnerCircleMember"("ownerId", "memberId");

-- CreateIndex
CREATE INDEX "InnerCircleMember_ownerId_idx" ON "InnerCircleMember"("ownerId");

-- CreateIndex
CREATE INDEX "InnerCircleMember_memberId_idx" ON "InnerCircleMember"("memberId");

-- CreateIndex
CREATE INDEX "AmbientMoment_authorId_createdAt_idx" ON "AmbientMoment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "AmbientMoment_expiresAt_idx" ON "AmbientMoment"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AmbientWidgetToken_tokenHash_key" ON "AmbientWidgetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AmbientWidgetToken_userId_idx" ON "AmbientWidgetToken"("userId");

-- AddForeignKey
ALTER TABLE "InnerCircleMember" ADD CONSTRAINT "InnerCircleMember_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InnerCircleMember" ADD CONSTRAINT "InnerCircleMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbientMoment" ADD CONSTRAINT "AmbientMoment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmbientWidgetToken" ADD CONSTRAINT "AmbientWidgetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
