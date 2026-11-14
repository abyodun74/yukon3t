-- Like groups (src/lib/like-groups.ts): a Muse and the feed post(s) showing the same video share ONE like count.
-- Hand-written and additive. Every statement is idempotent (IF NOT EXISTS, "likeGroupId" IS NULL guards,
-- ON CONFLICT DO NOTHING, counters recomputed from the rows), so a re-run changes nothing. It touches only rows in a
-- group: posts made by resharing a Muse (MuseRepost.postId), posts shared to Muse (Muse.sharedPostId) and those Muses.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "likeGroupId" TEXT;

-- AlterTable
ALTER TABLE "Muse" ADD COLUMN IF NOT EXISTS "likeGroupId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Post_likeGroupId_idx" ON "Post"("likeGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Muse_likeGroupId_idx" ON "Muse"("likeGroupId");

-- Backfill 1: groups. The links form a graph (Muse -- its reshare posts, post -- the Muses shared from it, and a
-- reshare post can itself be shared to Muse again); each connected part is one group, named after its smallest node.
DROP TABLE IF EXISTS "_like_group_members";
CREATE TEMP TABLE "_like_group_members" AS
WITH RECURSIVE edges AS (
  SELECT 'm:' || r."museId" AS a, 'p:' || r."postId" AS b
  FROM "MuseRepost" r
  JOIN "Post" p ON p."id" = r."postId"
  UNION
  SELECT 'm:' || m."id", 'p:' || m."sharedPostId"
  FROM "Muse" m
  JOIN "Post" p ON p."id" = m."sharedPostId"
),
undirected AS (
  SELECT a, b FROM edges
  UNION
  SELECT b, a FROM edges
),
reach (node, root) AS (
  SELECT a, a FROM undirected
  UNION
  SELECT u.b, r.root FROM reach r JOIN undirected u ON u.a = r.node
)
SELECT node, substr(MIN(root), 3) AS group_id
FROM reach
GROUP BY node;

UPDATE "Post" p
SET "likeGroupId" = g.group_id
FROM "_like_group_members" g
WHERE g.node = 'p:' || p."id" AND p."likeGroupId" IS NULL;

UPDATE "Muse" m
SET "likeGroupId" = g.group_id
FROM "_like_group_members" g
WHERE g.node = 'm:' || m."id" AND m."likeGroupId" IS NULL;

-- Backfill 2: everyone who liked any member (a post Like, or a Muse reaction of any emoji), once per group.
DROP TABLE IF EXISTS "_like_group_likers";
CREATE TEMP TABLE "_like_group_likers" AS
SELECT p."likeGroupId" AS group_id, l."userId" AS user_id
FROM "Like" l
JOIN "Post" p ON p."id" = l."postId"
WHERE p."likeGroupId" IS NOT NULL
UNION
SELECT m."likeGroupId", r."userId"
FROM "MuseReaction" r
JOIN "Muse" m ON m."id" = r."museId"
WHERE m."likeGroupId" IS NOT NULL;

-- Backfill 3: each liker's like on every member they can certainly see. Posts: published, Everyone, outside any
-- Circle (a reshare post always is). Muses: published. Never across a block either way with the member's author.
-- Members left out still show the group count; their own "liked" state fills in when the person likes there.
INSERT INTO "Like" ("id", "userId", "postId", "createdAt")
SELECT gen_random_uuid()::text, k.user_id, p."id", CURRENT_TIMESTAMP
FROM "Post" p
JOIN "_like_group_likers" k ON k.group_id = p."likeGroupId"
WHERE p."moderationStatus" = 'PUBLISHED'
  AND p."visibility" = 'PUBLIC'
  AND p."circleId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Block" b
    WHERE (b."blockerId" = k.user_id AND b."blockedId" = p."authorId")
       OR (b."blockerId" = p."authorId" AND b."blockedId" = k.user_id)
  )
ON CONFLICT ("userId", "postId") DO NOTHING;

INSERT INTO "MuseReaction" ("id", "museId", "userId", "emoji", "createdAt")
SELECT gen_random_uuid()::text, m."id", k.user_id, U&'\2764\FE0F', CURRENT_TIMESTAMP
FROM "Muse" m
JOIN "_like_group_likers" k ON k.group_id = m."likeGroupId"
WHERE m."moderationStatus" = 'PUBLISHED'
  AND NOT EXISTS (
    SELECT 1 FROM "Block" b
    WHERE (b."blockerId" = k.user_id AND b."blockedId" = m."authorId")
       OR (b."blockerId" = m."authorId" AND b."blockedId" = k.user_id)
  )
ON CONFLICT ("museId", "userId") DO NOTHING;

-- Backfill 4: every member's counter = the group's distinct likers (a person who liked both sides counts once).
UPDATE "Post" p
SET "likeCount" = (SELECT COUNT(*) FROM "_like_group_likers" k WHERE k.group_id = p."likeGroupId")
WHERE p."likeGroupId" IS NOT NULL;

UPDATE "Muse" m
SET "likeCount" = (SELECT COUNT(*) FROM "_like_group_likers" k WHERE k.group_id = m."likeGroupId")
WHERE m."likeGroupId" IS NOT NULL;

DROP TABLE IF EXISTS "_like_group_members";
DROP TABLE IF EXISTS "_like_group_likers";
