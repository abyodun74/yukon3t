import type { ModerationStatus } from "@/generated/prisma/enums";

export type FlatComment = {
  id: string;
  parentId: string | null;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  // Only ever PUBLISHED or REMOVED in practice — callers filter FLAGGED out
  // at the query level — but typed against the full enum since Prisma's
  // `where: { in: [...] }` doesn't narrow the return type.
  moderationStatus: ModerationStatus;
  author: { id: string; name: string | null; username?: string | null; avatarUrl?: string | null };
  reactions: { emoji: string; userId: string }[];
};

export type CommentNode = FlatComment & { replies: CommentNode[] };

/** Turns a flat, createdAt-ordered comment list into a nested reply tree — arbitrary depth, not just one level. */
export function buildCommentTree(flat: FlatComment[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const comment of flat) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  const roots: CommentNode[] = [];
  for (const comment of flat) {
    const node = byId.get(comment.id)!;
    const parent = comment.parentId ? byId.get(comment.parentId) : undefined;
    if (parent) {
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
