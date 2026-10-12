import type { TransactionClient } from "@/lib/prisma";

/**
 * How many PUBLISHED comments deleting this comment takes with it: the
 * comment itself plus every reply under it at any depth (the delete
 * cascades down the whole chain — see Comment.parent in schema.prisma).
 * That is what has to come off Post.commentCount, which counts every
 * PUBLISHED comment on the post, replies included (see createComment).
 */
export async function countPublishedInThread(tx: TransactionClient, commentId: string): Promise<number> {
  const root = await tx.comment.findUnique({ where: { id: commentId }, select: { moderationStatus: true } });
  if (!root) return 0;

  let published = root.moderationStatus === "PUBLISHED" ? 1 : 0;
  let parentIds = [commentId];
  while (parentIds.length > 0) {
    const replies = await tx.comment.findMany({
      where: { parentId: { in: parentIds } },
      select: { id: true, moderationStatus: true },
    });
    published += replies.filter((r) => r.moderationStatus === "PUBLISHED").length;
    parentIds = replies.map((r) => r.id);
  }
  return published;
}
