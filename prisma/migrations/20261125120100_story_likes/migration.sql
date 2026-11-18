-- Story likes (actions/story-likes.ts, src/lib/story-likes.ts), step 2 of 2: the heart on a story, one row per person
-- per story. Additive only: one new table, nothing existing is altered or dropped. Both foreign keys cascade, so the
-- expire-stories cron / deleteStory and account deletion remove likes with the story or the account. Hand-written to
-- match what `prisma migrate diff` produces for the schema change (checked against
-- `--from-schema <previous schema> --to-schema prisma/schema.prisma`); it holds no DROP INDEX for the hand-written
-- HNSW indexes.

-- CreateTable
CREATE TABLE "StoryLike" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryLike_userId_idx" ON "StoryLike"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryLike_storyId_userId_key" ON "StoryLike"("storyId", "userId");

-- AddForeignKey
ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryLike" ADD CONSTRAINT "StoryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
