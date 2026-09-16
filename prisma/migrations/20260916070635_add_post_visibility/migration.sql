-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'CONNECTIONS_ONLY', 'PRIVATE');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "visibility" "PostVisibility" NOT NULL DEFAULT 'PUBLIC';

-- Backfill: getVisiblePostsWhere used to enforce a Post's effective audience
-- entirely off the author's account-wide User.postsVisibility (for non-Circle
-- posts). Now that a post's own `visibility` column is what's enforced
-- instead (see src/lib/post-visibility.ts), existing posts default to PUBLIC
-- above, which would silently widen the audience of every already-published
-- post belonging to a "connections only" account. Backfilling those authors'
-- existing non-Circle posts to CONNECTIONS_ONLY preserves the privacy they
-- already had. HIDDEN needs no equivalent backfill — it stays enforced as
-- its own always-on account-level check, untouched by this column.
UPDATE "Post"
SET "visibility" = 'CONNECTIONS_ONLY'
WHERE "circleId" IS NULL
  AND "authorId" IN (SELECT "id" FROM "User" WHERE "postsVisibility" = 'CONNECTIONS_ONLY');
