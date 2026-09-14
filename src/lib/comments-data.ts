import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { ReactionSummary } from "@/lib/reactions";

// A post with more comments than this loads only the oldest COMMENT_LOAD_LIMIT
// — safe to cap on the ascending (oldest-first) order this query already
// uses, since a reply's parent is always created earlier than the reply
// itself, so buildCommentTree (src/lib/comment-tree.ts) never ends up with
// an orphaned reply whose parent got cut off. Same "cap it, don't build full
// pagination yet" tradeoff as getPostLikers' LIKERS_LIMIT (src/app/actions/
// likes.ts) — revisit with real cursor pagination if a post's comment count
// actually approaches this in practice.
export const COMMENT_LOAD_LIMIT = 500;

/**
 * Shared between the SSR standalone post page (src/app/post/[id]/page.tsx)
 * and getPostComments (src/app/actions/comments.ts, the client-fetch
 * counterpart used for inline expand-in-place on Home/Circles) so both load
 * the same bounded set of comments and compute reactions the same way —
 * aggregated in Postgres (groupBy), batched across every comment on the
 * post in one query, rather than one row per reactor per comment.
 */
export async function loadPostComments(postId: string, viewerId: string) {
  const commentWhere: Prisma.CommentWhereInput = { postId, moderationStatus: { in: ["PUBLISHED", "REMOVED"] } };
  const [rawComments, totalCount] = await Promise.all([
    prisma.comment.findMany({
      where: commentWhere,
      orderBy: { createdAt: "asc" },
      take: COMMENT_LOAD_LIMIT,
      include: {
        author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      },
    }),
    prisma.comment.count({ where: commentWhere }),
  ]);

  const commentIds = rawComments.map((c) => c.id);
  const [reactionCounts, myReactions] = commentIds.length
    ? await Promise.all([
        prisma.commentReaction.groupBy({
          by: ["commentId", "emoji"],
          where: { commentId: { in: commentIds } },
          _count: { emoji: true },
        }),
        prisma.commentReaction.findMany({
          where: { userId: viewerId, commentId: { in: commentIds } },
          select: { commentId: true, emoji: true },
        }),
      ])
    : [[], []];
  const myReactionByCommentId = new Map(myReactions.map((r) => [r.commentId, r.emoji]));
  const reactionsByCommentId = new Map<string, ReactionSummary[]>();
  for (const c of reactionCounts) {
    const list = reactionsByCommentId.get(c.commentId) ?? [];
    list.push({ emoji: c.emoji, count: c._count.emoji, reactedByMe: c.emoji === myReactionByCommentId.get(c.commentId) });
    reactionsByCommentId.set(c.commentId, list);
  }

  return {
    comments: rawComments.map((c) => ({ ...c, reactions: reactionsByCommentId.get(c.id) ?? [] })),
    totalCount,
  };
}
