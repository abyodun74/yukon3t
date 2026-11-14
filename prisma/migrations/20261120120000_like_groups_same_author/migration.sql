-- Like groups, same author only (owner decision 2026-11-14: "each user's Muse copy has its own like count").
-- src/lib/like-groups.ts: a like group now links ONLY items made by the same person (a Muse and its own author's
-- reshare post of it, a post and the Muse its own author made from it, chains of such links). Copies made by someone
-- else are independent: their own likes and their own count.
--
-- This regroups the rows 20261119130000_like_groups grouped across authors and recounts them. Hand-written, data only
-- (no schema change, no index touched), and safe to re-run: every step is recomputed from the rows, temp tables are
-- dropped/recreated with IF EXISTS, and on a second run old and new groups are equal so the cleanup in step 3 finds
-- nothing.
--
-- Already-propagated likes (the limitation). 20261119130000 and the app since then copied each liker's like onto every
-- member of the (cross-author) group. A copied row can't in general be told apart from a real like. Step 3 deletes a
-- copied row only when it is PROVABLY that migration's backfill: created inside the recorded run of 20261119130000
-- (its _prisma_migrations started_at..finished_at, 1s margin), a plain like or a heart reaction, on an item whose
-- new group holds no like by that person made outside that run, while that person has a like made BEFORE that run on
-- an item of the same old group that is now in another group (the like it was copied from). Everything else is kept:
-- likes the app copied after that migration (via likeVisibleMembers / inheritGroupLikers), copies whose source item
-- was deleted, and anything when _prisma_migrations or the run can't be found. Counters are then recomputed from the
-- rows that remain. To review what is left (read-only; lists every cross-author linked pair with both counts and how
-- many people have a like on both sides, an upper bound on copies still there, since some liked both on purpose):
-- SELECT x.link, x.muse_id, m."authorId" AS muse_author, m."likeCount" AS muse_likes, x.post_id, p."authorId" AS post_author, p."likeCount" AS post_likes, (SELECT COUNT(*) FROM "Like" l JOIN "MuseReaction" r ON r."userId" = l."userId" AND r."museId" = x.muse_id WHERE l."postId" = x.post_id) AS likers_on_both FROM (SELECT 'feed_reshare_of_muse' AS link, "museId" AS muse_id, "postId" AS post_id FROM "MuseRepost" WHERE "postId" IS NOT NULL UNION ALL SELECT 'muse_made_from_post', "id", "sharedPostId" FROM "Muse" WHERE "sharedPostId" IS NOT NULL) x JOIN "Muse" m ON m."id" = x.muse_id JOIN "Post" p ON p."id" = x.post_id WHERE m."authorId" <> p."authorId" ORDER BY likers_on_both DESC;

-- Step 1: every item currently in a group, with the group it is in now (the old, possibly cross-author grouping).
DROP TABLE IF EXISTS "_lgsa_old";
CREATE TEMP TABLE "_lgsa_old" AS
SELECT 'p' AS kind, p."id" AS item_id, p."likeGroupId" AS old_group
FROM "Post" p
WHERE p."likeGroupId" IS NOT NULL
UNION ALL
SELECT 'm', m."id", m."likeGroupId"
FROM "Muse" m
WHERE m."likeGroupId" IS NOT NULL;

-- Step 2: the new groups. Same graph as 20261119130000 (Muse -- its reshare posts, post -- the Muses shared from it,
-- transitively), but every edge requires the two items to have the same author, so each connected part is
-- single-author. Named after its smallest node; an item on no same-author edge gets no group.
DROP TABLE IF EXISTS "_lgsa_new";
CREATE TEMP TABLE "_lgsa_new" AS
WITH RECURSIVE edges AS (
  SELECT 'm:' || r."museId" AS a, 'p:' || r."postId" AS b
  FROM "MuseRepost" r
  JOIN "Post" p ON p."id" = r."postId"
  JOIN "Muse" m ON m."id" = r."museId"
  WHERE p."authorId" = m."authorId"
  UNION
  SELECT 'm:' || m."id", 'p:' || m."sharedPostId"
  FROM "Muse" m
  JOIN "Post" p ON p."id" = m."sharedPostId"
  WHERE p."authorId" = m."authorId"
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
SELECT substr(node, 1, 1) AS kind, substr(node, 3) AS item_id, substr(MIN(root), 3) AS group_id
FROM reach
GROUP BY node;

-- Every item touched (in a group before or after), with its old group and its new key: the new group id, or for an
-- item left alone its own kind + id (a group of one).
DROP TABLE IF EXISTS "_lgsa_items";
CREATE TEMP TABLE "_lgsa_items" AS
SELECT
  COALESCE(o.kind, n.kind) AS kind,
  COALESCE(o.item_id, n.item_id) AS item_id,
  o.old_group,
  COALESCE('g:' || n.group_id, 'i:' || COALESCE(o.kind, n.kind) || ':' || COALESCE(o.item_id, n.item_id)) AS new_key
FROM "_lgsa_old" o
FULL OUTER JOIN "_lgsa_new" n ON n.kind = o.kind AND n.item_id = o.item_id;

-- Step 3: remove only provable backfill copies across what are now independent items (see the header). The backfill
-- stored CURRENT_TIMESTAMP in the session's time zone (GMT on Neon), so the window is read in the session's time zone
-- too; if that ever differs, the window matches nothing and nothing is removed.
DROP TABLE IF EXISTS "_lgsa_window";
CREATE TEMP TABLE "_lgsa_window" (lo TIMESTAMP(3) NOT NULL, hi TIMESTAMP(3) NOT NULL);

DO $$
BEGIN
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO "_lgsa_window" (lo, hi)
      SELECT started_at::timestamp - INTERVAL '1 second', finished_at::timestamp + INTERVAL '1 second'
      FROM "_prisma_migrations"
      WHERE migration_name = '20261119130000_like_groups'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    $q$;
  END IF;
END
$$;

-- Every like on an item that was in a group: a post Like, or a Muse reaction (is_copy_shape: a heart, the only emoji
-- the backfill wrote; any other emoji was chosen by the person and is never removed).
DROP TABLE IF EXISTS "_lgsa_likes";
CREATE TEMP TABLE "_lgsa_likes" AS
SELECT 'p' AS kind, l."id" AS like_id, l."userId" AS user_id, l."createdAt" AS created_at, i.old_group, i.new_key,
  TRUE AS is_copy_shape
FROM "Like" l
JOIN "_lgsa_items" i ON i.kind = 'p' AND i.item_id = l."postId"
WHERE i.old_group IS NOT NULL
UNION ALL
SELECT 'm', r."id", r."userId", r."createdAt", i.old_group, i.new_key, r."emoji" = U&'\2764\FE0F'
FROM "MuseReaction" r
JOIN "_lgsa_items" i ON i.kind = 'm' AND i.item_id = r."museId"
WHERE i.old_group IS NOT NULL;

DROP TABLE IF EXISTS "_lgsa_artifacts";
CREATE TEMP TABLE "_lgsa_artifacts" AS
SELECT c.kind, c.like_id
FROM "_lgsa_likes" c
WHERE c.is_copy_shape
  -- written during the recorded run of 20261119130000
  AND EXISTS (SELECT 1 FROM "_lgsa_window" w WHERE c.created_at BETWEEN w.lo AND w.hi)
  -- the person has no like of their own (made outside that run) anywhere in this item's new group
  AND NOT EXISTS (
    SELECT 1 FROM "_lgsa_likes" s
    WHERE s.user_id = c.user_id
      AND s.new_key = c.new_key
      AND NOT EXISTS (SELECT 1 FROM "_lgsa_window" w WHERE s.created_at BETWEEN w.lo AND w.hi)
  )
  -- and does have one made before that run on an item of the same old group that is now independent of this one
  AND EXISTS (
    SELECT 1 FROM "_lgsa_likes" s
    WHERE s.user_id = c.user_id
      AND s.old_group = c.old_group
      AND s.new_key <> c.new_key
      AND s.created_at < (SELECT MIN(w.lo) FROM "_lgsa_window" w)
  );

DELETE FROM "Like" l
USING "_lgsa_artifacts" a
WHERE a.kind = 'p' AND l."id" = a.like_id;

DELETE FROM "MuseReaction" r
USING "_lgsa_artifacts" a
WHERE a.kind = 'm' AND r."id" = a.like_id;

-- Step 4: write the new groups; items on no same-author link leave their group.
UPDATE "Post" p
SET "likeGroupId" = n.group_id
FROM "_lgsa_new" n
WHERE n.kind = 'p' AND p."id" = n.item_id AND p."likeGroupId" IS DISTINCT FROM n.group_id;

UPDATE "Muse" m
SET "likeGroupId" = n.group_id
FROM "_lgsa_new" n
WHERE n.kind = 'm' AND m."id" = n.item_id AND m."likeGroupId" IS DISTINCT FROM n.group_id;

UPDATE "Post" p
SET "likeGroupId" = NULL
WHERE p."likeGroupId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "_lgsa_new" n WHERE n.kind = 'p' AND n.item_id = p."id");

UPDATE "Muse" m
SET "likeGroupId" = NULL
WHERE m."likeGroupId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "_lgsa_new" n WHERE n.kind = 'm' AND n.item_id = m."id");

-- Step 5: exact counters for every item touched. In a group: the group's distinct likers (a person who liked several
-- members counts once). Alone: its own likes (post Like rows / Muse reactions of any emoji).
DROP TABLE IF EXISTS "_lgsa_group_likers";
CREATE TEMP TABLE "_lgsa_group_likers" AS
SELECT p."likeGroupId" AS group_id, l."userId" AS user_id
FROM "Like" l
JOIN "Post" p ON p."id" = l."postId"
WHERE p."likeGroupId" IS NOT NULL
UNION
SELECT m."likeGroupId", r."userId"
FROM "MuseReaction" r
JOIN "Muse" m ON m."id" = r."museId"
WHERE m."likeGroupId" IS NOT NULL;

UPDATE "Post" p
SET "likeCount" = (SELECT COUNT(*) FROM "_lgsa_group_likers" k WHERE k.group_id = p."likeGroupId")
WHERE p."likeGroupId" IS NOT NULL;

UPDATE "Muse" m
SET "likeCount" = (SELECT COUNT(*) FROM "_lgsa_group_likers" k WHERE k.group_id = m."likeGroupId")
WHERE m."likeGroupId" IS NOT NULL;

UPDATE "Post" p
SET "likeCount" = (SELECT COUNT(*) FROM "Like" l WHERE l."postId" = p."id")
FROM "_lgsa_items" i
WHERE i.kind = 'p' AND i.item_id = p."id" AND p."likeGroupId" IS NULL;

UPDATE "Muse" m
SET "likeCount" = (SELECT COUNT(*) FROM "MuseReaction" r WHERE r."museId" = m."id")
FROM "_lgsa_items" i
WHERE i.kind = 'm' AND i.item_id = m."id" AND m."likeGroupId" IS NULL;

DROP TABLE IF EXISTS "_lgsa_group_likers";
DROP TABLE IF EXISTS "_lgsa_artifacts";
DROP TABLE IF EXISTS "_lgsa_likes";
DROP TABLE IF EXISTS "_lgsa_window";
DROP TABLE IF EXISTS "_lgsa_items";
DROP TABLE IF EXISTS "_lgsa_new";
DROP TABLE IF EXISTS "_lgsa_old";
