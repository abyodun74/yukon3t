-- Gift Universe Phase B ("Challenge foundation", src/lib/challenges.ts): a challenge a Circle owner / co-admin or a
-- live stream's host puts up, the people who join it, and the unranked winners its host declares (no score, no rank,
-- no place, no leaderboard: none is stored anywhere). Plus Notification.challengeId, so a CHALLENGE_RESULT bell row
-- goes away with its challenge. Additive and idempotent: one new enum type, three new tables, one new nullable column,
-- their keys and two hand-written CHECKs. Nothing is dropped, and no pgvector HNSW index is touched. The enum values
-- it relies on were added by 20261115120000..20261115120300, each in a migration of its own.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChallengeStatus') THEN
    CREATE TYPE "ChallengeStatus" AS ENUM ('OPEN', 'DECIDED', 'CANCELLED');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "challengeId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Challenge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hostId" TEXT,
    "circleId" TEXT,
    "liveStreamId" TEXT,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "editableUntil" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChallengeParticipant" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ChallengeWinner" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardSendId" TEXT,

    CONSTRAINT "ChallengeWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Challenge_circleId_status_createdAt_idx" ON "Challenge"("circleId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Challenge_liveStreamId_status_createdAt_idx" ON "Challenge"("liveStreamId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Challenge_hostId_status_createdAt_idx" ON "Challenge"("hostId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Challenge_decidedById_decidedAt_idx" ON "Challenge"("decidedById", "decidedAt");
CREATE INDEX IF NOT EXISTS "ChallengeParticipant_userId_joinedAt_idx" ON "ChallengeParticipant"("userId", "joinedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChallengeParticipant_challengeId_userId_key" ON "ChallengeParticipant"("challengeId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ChallengeWinner_awardSendId_key" ON "ChallengeWinner"("awardSendId");
CREATE INDEX IF NOT EXISTS "ChallengeWinner_userId_createdAt_idx" ON "ChallengeWinner"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ChallengeWinner_challengeId_userId_key" ON "ChallengeWinner"("challengeId", "userId");
CREATE INDEX IF NOT EXISTS "Notification_challengeId_idx" ON "Notification"("challengeId");

-- AddForeignKey, and hand-written CHECKs (Prisma doesn't diff CHECK constraints, so they cause no drift).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_challengeId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_hostId_fkey') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_decidedById_fkey') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_cancelledById_fkey') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_circleId_fkey') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_circleId_fkey" FOREIGN KEY ("circleId") REFERENCES "Circle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_liveStreamId_fkey') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeParticipant_challengeId_fkey') THEN
    ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeParticipant_userId_fkey') THEN
    ALTER TABLE "ChallengeParticipant" ADD CONSTRAINT "ChallengeParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeWinner_challengeId_fkey') THEN
    ALTER TABLE "ChallengeWinner" ADD CONSTRAINT "ChallengeWinner_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeWinner_userId_fkey') THEN
    ALTER TABLE "ChallengeWinner" ADD CONSTRAINT "ChallengeWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChallengeWinner_awardSendId_fkey') THEN
    ALTER TABLE "ChallengeWinner" ADD CONSTRAINT "ChallengeWinner_awardSendId_fkey" FOREIGN KEY ("awardSendId") REFERENCES "GiftSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- Exactly one host context: a Circle or a live stream, never both, never neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_one_context') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_one_context" CHECK (("circleId" IS NULL) <> ("liveStreamId" IS NULL));
  END IF;
  -- A title of 1..80 characters and a description of at most 280 (CHALLENGE_TITLE_MAX / CHALLENGE_DESCRIPTION_MAX).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Challenge_text_length') THEN
    ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_text_length" CHECK (
      char_length("title") BETWEEN 1 AND 80 AND ("description" IS NULL OR char_length("description") <= 280)
    );
  END IF;
END $$;
