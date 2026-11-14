import type { Prisma } from "@/generated/prisma/client";
import { prisma, type TransactionClient } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";

/**
 * Like groups: ONE person's copies of the same video, on Feed and on Muse, have ONE like count.
 *
 * Same-author rule (owner decision 2026-11-14: "each user's Muse copy has its own like count"). A group only ever
 * links items created by the SAME person (same authorId), so every group is single-author:
 * - a Muse and the feed post its own author made by resharing it to Home (toggleMuseRepost; MuseRepost.postId),
 * - a video post and the Muse its own author made from it (shareToMuse; Muse.sharedPostId),
 * - transitively, but only along such same-author links.
 * A copy made by someone else (another person's Muse from my post, another person's feed reshare of my Muse) is NOT
 * a member: it starts with no group, its own likes and its own count, and nothing propagates either way
 * (likeGroupForNewMember decides this at create time). Ordinary reposts and shares of a post (repostOfId /
 * sharedPostId) are not members either: PostCard already sends their likes to the original post (interactionTargetId).
 * Columns Post.likeGroupId / Muse.likeGroupId (migrations 20261119130000_like_groups, regrouped same-author only by
 * 20261120120000_like_groups_same_author). The value is the id of the item the group started from, with no FK, so
 * deleting that item leaves the group intact.
 *
 * A like is a post `Like` or a `MuseReaction` of any emoji. Rules (all applied under a per-group advisory lock, inside
 * one transaction, so concurrent likes on different members serialize):
 * - liking a member adds the person's like to every member they can see (posts: their getVisiblePostsWhere; Muses:
 *   published, author not blocked either way); a Muse gets GROUP_LIKE_EMOJI, an existing reaction is kept;
 * - unliking removes the person's like from every member;
 * - every member's likeCount = the number of DISTINCT people with a like on ANY member (recomputeLikeGroup), so the
 *   number is identical everywhere and nobody is counted twice.
 * Only the surface tapped notifies its owner (the same person for every member), and only when the person wasn't
 * already a liker of the group.
 */

/**
 * The like group a new copy joins: the source's group (or a new one named after the source) when the person making
 * the copy is the source's own author, otherwise null (an independent item: own likes, own count, nothing inherited).
 */
export function likeGroupForNewMember(
  source: { id: string; authorId: string; likeGroupId: string | null },
  creatorId: string,
): string | null {
  if (source.authorId !== creatorId) return null;
  return source.likeGroupId ?? source.id;
}

export const GROUP_LIKE_EMOJI = "❤️";

export function likeGroupLockKey(groupId: string) {
  return `like-group:${groupId}`;
}

/** Serializes every change to one group's likes for the rest of the transaction. */
export async function lockLikeGroup(tx: TransactionClient, groupId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${likeGroupLockKey(groupId)}))`;
}

/** Distinct people with a like on any member of the group. */
export async function countGroupLikers(tx: TransactionClient, groupId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT l."userId" FROM "Like" l JOIN "Post" p ON p."id" = l."postId" WHERE p."likeGroupId" = ${groupId}
      UNION
      SELECT r."userId" FROM "MuseReaction" r JOIN "Muse" m ON m."id" = r."museId" WHERE m."likeGroupId" = ${groupId}
    ) likers`;
  return Number(rows[0]?.n ?? 0);
}

/** Sets every member's likeCount to the group's distinct-liker count and returns it. Call with the group locked. */
export async function recomputeLikeGroup(tx: TransactionClient, groupId: string): Promise<number> {
  const likeCount = await countGroupLikers(tx, groupId);
  await tx.post.updateMany({ where: { likeGroupId: groupId }, data: { likeCount } });
  await tx.muse.updateMany({ where: { likeGroupId: groupId }, data: { likeCount } });
  return likeCount;
}

/** Whether the person has a like on any member of the group. */
export async function isGroupLiker(tx: TransactionClient, groupId: string, userId: string): Promise<boolean> {
  const [likes, reactions] = await Promise.all([
    tx.like.count({ where: { userId, post: { likeGroupId: groupId } } }),
    tx.museReaction.count({ where: { userId, muse: { likeGroupId: groupId } } }),
  ]);
  return likes + reactions > 0;
}

/**
 * Adds the person's like to every member they can see (idempotent: existing likes and reactions are kept). Two reads
 * and at most two inserts whatever the group's size.
 */
export async function likeVisibleMembers(
  tx: TransactionClient,
  {
    groupId,
    userId,
    visiblePostsWhere,
    blockedIds,
  }: {
    groupId: string;
    userId: string;
    /** getVisiblePostsWhere(userId): the liker's own view of posts. */
    visiblePostsWhere: Prisma.PostWhereInput;
    /** getBlockedEitherWayIds(userId). */
    blockedIds: ReadonlySet<string>;
  },
) {
  const [posts, muses] = await Promise.all([
    tx.post.findMany({ where: { AND: [{ likeGroupId: groupId }, visiblePostsWhere] }, select: { id: true } }),
    tx.muse.findMany({
      where: { likeGroupId: groupId, moderationStatus: "PUBLISHED", authorId: { notIn: [...blockedIds] } },
      select: { id: true },
    }),
  ]);
  if (posts.length) {
    await tx.like.createMany({ data: posts.map((p) => ({ userId, postId: p.id })), skipDuplicates: true });
  }
  if (muses.length) {
    await tx.museReaction.createMany({
      data: muses.map((m) => ({ museId: m.id, userId, emoji: GROUP_LIKE_EMOJI })),
      skipDuplicates: true,
    });
  }
}

/** Removes the person's like from every member of the group. */
export async function unlikeGroup(tx: TransactionClient, groupId: string, userId: string) {
  await tx.like.deleteMany({ where: { userId, post: { likeGroupId: groupId } } });
  await tx.museReaction.deleteMany({ where: { userId, muse: { likeGroupId: groupId } } });
}

/**
 * A member just added to a group (the author's own reshare post of their Muse, or the author's own Muse made from
 * their post; never someone else's copy, see likeGroupForNewMember) gets the group's existing likers at once, so it
 * shows the group's count and each liker sees it liked. Public by construction (both are created PUBLIC / on the
 * public Muse feed), so the only rule is no block either way with the new member's author. One set-based insert;
 * call with the group locked, then recomputeLikeGroup.
 */
export async function inheritGroupLikers(
  tx: TransactionClient,
  groupId: string,
  member: { kind: "post" | "muse"; id: string; authorId: string },
) {
  if (member.kind === "post") {
    await tx.$executeRaw`
      INSERT INTO "Like" ("id", "userId", "postId", "createdAt")
      SELECT gen_random_uuid()::text, likers."userId", ${member.id}, CURRENT_TIMESTAMP
      FROM (
        SELECT l."userId" FROM "Like" l JOIN "Post" p ON p."id" = l."postId" WHERE p."likeGroupId" = ${groupId}
        UNION
        SELECT r."userId" FROM "MuseReaction" r JOIN "Muse" m ON m."id" = r."museId" WHERE m."likeGroupId" = ${groupId}
      ) likers
      WHERE NOT EXISTS (
        SELECT 1 FROM "Block" b
        WHERE (b."blockerId" = likers."userId" AND b."blockedId" = ${member.authorId})
           OR (b."blockerId" = ${member.authorId} AND b."blockedId" = likers."userId")
      )
      ON CONFLICT ("userId", "postId") DO NOTHING`;
    return;
  }
  await tx.$executeRaw`
    INSERT INTO "MuseReaction" ("id", "museId", "userId", "emoji", "createdAt")
    SELECT gen_random_uuid()::text, ${member.id}, likers."userId", ${GROUP_LIKE_EMOJI}, CURRENT_TIMESTAMP
    FROM (
      SELECT l."userId" FROM "Like" l JOIN "Post" p ON p."id" = l."postId" WHERE p."likeGroupId" = ${groupId}
      UNION
      SELECT r."userId" FROM "MuseReaction" r JOIN "Muse" m ON m."id" = r."museId" WHERE m."likeGroupId" = ${groupId}
    ) likers
    WHERE NOT EXISTS (
      SELECT 1 FROM "Block" b
      WHERE (b."blockerId" = likers."userId" AND b."blockedId" = ${member.authorId})
         OR (b."blockerId" = ${member.authorId} AND b."blockedId" = likers."userId")
    )
    ON CONFLICT ("museId", "userId") DO NOTHING`;
}

/** Distinct, non-null group ids. */
export function likeGroupIdsOf(items: readonly { likeGroupId?: string | null }[]): string[] {
  return [...new Set(items.map((i) => i.likeGroupId).filter((id): id is string => Boolean(id)))];
}

/**
 * After a member (or an account) is deleted outside a group transaction: recompute each group's counters, one short
 * locked transaction per group. Best effort: a failure is reported and leaves the old (still equal) counters.
 */
export async function recomputeLikeGroups(groupIds: readonly string[]) {
  for (const groupId of groupIds) {
    try {
      await prisma.$transaction(async (tx) => {
        await lockLikeGroup(tx, groupId);
        await recomputeLikeGroup(tx, groupId);
      });
    } catch (err) {
      await captureError(err, { action: "recomputeLikeGroups", groupId });
    }
  }
}

/**
 * Groups whose count an account's deletion can change: ones it liked, or has a member of. Never throws (an account
 * deletion must not fail over a recount): a failure is reported and answers none.
 */
export async function likeGroupsTouchedByUser(userId: string): Promise<string[]> {
  try {
    return await loadLikeGroupsTouchedByUser(userId);
  } catch (err) {
    await captureError(err, { action: "likeGroupsTouchedByUser" });
    return [];
  }
}

async function loadLikeGroupsTouchedByUser(userId: string): Promise<string[]> {
  const [liked, reacted, posts, muses] = await Promise.all([
    prisma.like.findMany({
      where: { userId, post: { likeGroupId: { not: null } } },
      select: { post: { select: { likeGroupId: true } } },
    }),
    prisma.museReaction.findMany({
      where: { userId, muse: { likeGroupId: { not: null } } },
      select: { muse: { select: { likeGroupId: true } } },
    }),
    prisma.post.findMany({
      where: { authorId: userId, likeGroupId: { not: null } },
      select: { likeGroupId: true },
      distinct: ["likeGroupId"],
    }),
    prisma.muse.findMany({
      where: { authorId: userId, likeGroupId: { not: null } },
      select: { likeGroupId: true },
      distinct: ["likeGroupId"],
    }),
  ]);
  return likeGroupIdsOf([...liked.map((l) => l.post), ...reacted.map((r) => r.muse), ...posts, ...muses]);
}
