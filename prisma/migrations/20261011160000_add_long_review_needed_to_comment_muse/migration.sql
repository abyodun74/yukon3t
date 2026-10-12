-- Hand-written (not `prisma migrate dev` output), so it carries none of the
-- DROP INDEX lines Prisma would add for the pgvector HNSW indexes.
--
-- Gives Comment and Muse the same "long-video review still owed" marker
-- Post already has. The moderate-long-videos cron selected these two on
-- "moderationStatus" = 'FLAGGED' instead, which a "flagged" verdict leaves
-- unchanged: the same row was claimed and re-reviewed on every tick, and
-- each pass overwrote an admin's approval from /admin/moderation.
--
-- Deliberately no backfill to true (unlike Post's own
-- 20260916205258_add_video_long_review_needed): a Comment or Muse that is
-- FLAGGED right now has either already been reviewed and is in that loop,
-- or will be decided by hand from the admin queue. Marking them true would
-- put every one of them through the pipeline once more.

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "videoLongReviewNeeded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Muse" ADD COLUMN     "videoLongReviewNeeded" BOOLEAN NOT NULL DEFAULT false;
