import { prisma } from "@/lib/prisma";
import type { ConcurrencyLimit } from "@/lib/concurrency-limit";
import { rowsByDuplicateSet, splitKeeperAndDuplicates } from "@/lib/moderation-duplicates";

// How far back to look for duplicate posts — bounds the scan to a recent,
// actionable window rather than the whole table's history. DM threads and
// groups are scanned regardless of age.
const DUPLICATE_SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type IdSet = { ids: string[] };

/**
 * Everything /admin/moderation's "Duplicates" section shows. The grouping
 * runs in Postgres (GROUP BY ... HAVING COUNT(*) > 1) and returns only the
 * ids of rows that are in a duplicate set, oldest set first, at most 200
 * sets per kind; details are then fetched for those ids alone. This used to
 * load the 1000 oldest DM threads, 1000 oldest groups (each with its
 * members and newest message) and up to 1000 recent posts with their full
 * text on every render, and group them in memory.
 */
export async function loadModerationDuplicates(now: Date, limit: ConcurrencyLimit) {
  const cutoff = new Date(now.getTime() - DUPLICATE_SCAN_WINDOW_MS);

  const [postSets, dmSets, groupSets] = await Promise.all([
    // Same author + identical non-empty text within the window. Ids come
    // back oldest first, so the first of each set is the one kept.
    limit(
      () => prisma.$queryRaw<IdSet[]>`
        SELECT array_agg(p."id" ORDER BY p."createdAt" ASC, p."id" ASC) AS "ids"
        FROM "Post" p
        WHERE p."createdAt" > ${cutoff}::timestamp
          AND p."content" <> ''
        GROUP BY p."authorId", p."content"
        HAVING COUNT(*) > 1
        ORDER BY MIN(p."createdAt") ASC
        LIMIT 200
      `,
    ),
    // Non-group conversations with exactly two members, grouped by that
    // pair. (conversationId, userId) is unique, so COUNT(*) = 2 means two
    // different people and MIN/MAX of userId are the two of them.
    limit(
      () => prisma.$queryRaw<IdSet[]>`
        SELECT array_agg(pair."conversationId" ORDER BY pair."createdAt" ASC, pair."conversationId" ASC) AS "ids"
        FROM (
          SELECT
            cm."conversationId",
            c."createdAt",
            MIN(cm."userId") AS "userA",
            MAX(cm."userId") AS "userB"
          FROM "ConversationMember" cm
          JOIN "Conversation" c ON c."id" = cm."conversationId"
          WHERE c."isGroup" = false
          GROUP BY cm."conversationId", c."createdAt"
          HAVING COUNT(*) = 2
        ) pair
        GROUP BY pair."userA", pair."userB"
        HAVING COUNT(*) > 1
        ORDER BY MIN(pair."createdAt") ASC
        LIMIT 200
      `,
    ),
    // Groups with the same creator and the same exact name — the real-world
    // case is a double-tap submit on /messages/new.
    limit(
      () => prisma.$queryRaw<IdSet[]>`
        SELECT array_agg(c."id" ORDER BY c."createdAt" ASC, c."id" ASC) AS "ids"
        FROM "Conversation" c
        WHERE c."isGroup" = true
          AND c."createdById" IS NOT NULL
          AND c."name" IS NOT NULL
          AND c."name" <> ''
        GROUP BY c."createdById", c."name"
        HAVING COUNT(*) > 1
        ORDER BY MIN(c."createdAt") ASC
        LIMIT 200
      `,
    ),
  ]);

  const postIds = postSets.flatMap((set) => set.ids);
  const dmIds = dmSets.flatMap((set) => set.ids);
  const groupIds = groupSets.flatMap((set) => set.ids);
  const conversationIds = [...dmIds, ...groupIds];

  const [posts, dms, groups, lastMessages] = await Promise.all([
    postIds.length === 0
      ? []
      : limit(() =>
          prisma.post.findMany({
            where: { id: { in: postIds } },
            select: { id: true, content: true, createdAt: true, author: { select: { name: true } } },
          }),
        ),
    dmIds.length === 0
      ? []
      : limit(() =>
          prisma.conversation.findMany({
            where: { id: { in: dmIds } },
            select: {
              id: true,
              createdAt: true,
              members: { select: { user: { select: { name: true } } } },
            },
          }),
        ),
    groupIds.length === 0
      ? []
      : limit(() =>
          prisma.conversation.findMany({
            where: { id: { in: groupIds } },
            select: {
              id: true,
              createdAt: true,
              name: true,
              createdBy: { select: { name: true } },
              _count: { select: { members: true } },
            },
          }),
        ),
    // Newest message per conversation, for the duplicate sets only (served
    // by Message's [conversationId, createdAt] index).
    conversationIds.length === 0
      ? []
      : limit(() =>
          prisma.message.groupBy({
            by: ["conversationId"],
            where: { conversationId: { in: conversationIds } },
            _max: { createdAt: true },
          }),
        ),
  ]);

  const lastMessageAt = new Map<string, Date>();
  for (const row of lastMessages) {
    if (row._max.createdAt) lastMessageAt.set(row.conversationId, row._max.createdAt);
  }

  const postGroups = rowsByDuplicateSet(
    postSets.map((set) => set.ids),
    posts,
  );
  const dmGroups = rowsByDuplicateSet(
    dmSets.map((set) => set.ids),
    dms,
  ).map((set) => splitKeeperAndDuplicates(set, lastMessageAt));
  const groupGroups = rowsByDuplicateSet(
    groupSets.map((set) => set.ids),
    groups,
  ).map((set) => splitKeeperAndDuplicates(set, lastMessageAt));

  const duplicateCount =
    postGroups.reduce((sum, g) => sum + g.length - 1, 0) +
    dmGroups.reduce((sum, g) => sum + g.duplicates.length, 0) +
    groupGroups.reduce((sum, g) => sum + g.duplicates.length, 0);

  return { postGroups, dmGroups, groupGroups, duplicateCount };
}
