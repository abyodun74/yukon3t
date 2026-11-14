import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds, isBlockedEitherWay } from "@/lib/blocks";
import type { MuseCommentView } from "@/lib/muse-comment-threads";

// Server half of Muse comments and replies (pure rules: muse-comment-threads.ts, actions: actions/muse-comments.ts).
// Kept out of the "use server" file so these helpers aren't callable from the browser.

/** Exactly the author fields the sheet shows (never a whole User row). */
export const MUSE_COMMENT_AUTHOR_SELECT = { id: true, name: true, username: true, avatarUrl: true } as const;

export const MUSE_COMMENT_SELECT = {
  id: true,
  parentId: true,
  content: true,
  gifUrl: true,
  createdAt: true,
  author: { select: MUSE_COMMENT_AUTHOR_SELECT },
} as const;

type MuseCommentRow = Prisma.MuseCommentGetPayload<{ select: typeof MUSE_COMMENT_SELECT }>;

/**
 * Which comments a viewer sees: PUBLISHED (a flagged one is never shown), by an ACTIVE account (a suspended,
 * deactivated or banned author's comments and replies are hidden), and by nobody blocked either way with the viewer.
 */
export function museCommentVisibleWhere(blockedIds: Iterable<string>): Prisma.MuseCommentWhereInput {
  return {
    moderationStatus: "PUBLISHED",
    author: { status: "ACTIVE" },
    authorId: { notIn: [...blockedIds] },
  };
}

/**
 * The Muse whose comments are asked for, if this viewer can see it: published, and its author not blocked either way
 * with the viewer. Null otherwise (answered as not_found, never as forbidden).
 */
export async function museForComments(museId: string, viewerId: string) {
  const muse = await prisma.muse.findUnique({
    where: { id: museId },
    select: { id: true, authorId: true, moderationStatus: true },
  });
  if (!muse || muse.moderationStatus !== "PUBLISHED") return null;
  if (await isBlockedEitherWay(viewerId, muse.authorId)) return null;
  return { id: muse.id, authorId: muse.authorId };
}

/** The viewer's blocked-either-way ids (empty for the guest preview identity, which blocks nobody). */
export async function blockedIdsFor(viewerId: string): Promise<Set<string>> {
  return new Set(await getBlockedEitherWayIds(viewerId));
}

/**
 * Rows -> what the browser gets, with exact counts for this viewer in three batched queries for the whole page (never
 * one per comment): replies it can see (top-level rows only), likes, and which of them are its own.
 */
export async function toMuseCommentViews(
  rows: MuseCommentRow[],
  viewerId: string,
  blockedIds: Set<string>,
): Promise<MuseCommentView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const topLevelIds = rows.filter((r) => r.parentId === null).map((r) => r.id);
  const [replyCounts, likeCounts, myLikes] = await Promise.all([
    topLevelIds.length
      ? prisma.museComment.groupBy({
          by: ["parentId"],
          where: { parentId: { in: topLevelIds }, ...museCommentVisibleWhere(blockedIds) },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.museCommentLike.groupBy({
      by: ["commentId"],
      where: { commentId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.museCommentLike.findMany({
      where: { userId: viewerId, commentId: { in: ids } },
      select: { commentId: true },
    }),
  ]);
  const repliesBy = new Map(replyCounts.map((r) => [r.parentId, r._count._all]));
  const likesBy = new Map(likeCounts.map((l) => [l.commentId, l._count._all]));
  const mine = new Set(myLikes.map((l) => l.commentId));
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    content: r.content,
    gifUrl: r.gifUrl,
    createdAt: r.createdAt,
    author: {
      id: r.author.id,
      name: r.author.name,
      username: r.author.username,
      avatarUrl: r.author.avatarUrl,
    },
    likeCount: likesBy.get(r.id) ?? 0,
    likedByMe: mine.has(r.id),
    replyCount: r.parentId === null ? repliesBy.get(r.id) ?? 0 : 0,
  }));
}
