-- Story reposts (actions/story-reshare.ts), step 2 of 2. Additive only: three nullable/defaulted columns and one unique
-- index on a brand-new column (every existing row is NULL there, so it can't conflict); nothing existing is altered or
-- dropped. Hand-written to match what `prisma migrate diff --from-schema <previous schema> --to-schema
-- prisma/schema.prisma --script` produces for the schema change; it holds no DROP INDEX for the hand-written HNSW
-- indexes.

-- Settings -> Privacy "Allow others to repost my Stories": on by default for everyone, existing accounts included.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "allowStoryReposts" BOOLEAN NOT NULL DEFAULT true;

-- A video Story's length (routing hint for the video scan when it is reposted). Null for existing Stories.
-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "videoDurationSeconds" INTEGER;

-- Idempotency key for a Muse made from a Story ("story:<storyId>:muse"), unique per author like Post's.
-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Muse_authorId_clientRequestId_key" ON "Muse"("authorId", "clientRequestId");
