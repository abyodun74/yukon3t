"use client";

import { CommentCard } from "@/components/comment-card";
import { useUiText } from "@/components/ui-text";
import { buildCommentTree, type FlatComment } from "@/lib/comment-tree";

export function CommentList({
  comments,
  postId,
  postAuthorId,
  viewerId,
  viewerIsAdmin,
  canModerate = false,
  onCommentCountChange,
}: {
  comments: FlatComment[];
  postId: string;
  postAuthorId: string;
  viewerId: string;
  viewerIsAdmin: boolean;
  /** Viewer is the owner/co-admin of the post's Circle (if any). */
  canModerate?: boolean;
  /** See CommentCard's own doc comment — only set by an inline-expanded (not server-rendered) comment section. */
  onCommentCountChange?: (delta: number) => void;
}) {
  const tree = buildCommentTree(comments);
  const { locale, dir, t } = useUiText();

  if (tree.length === 0) {
    return (
      <p lang={locale} dir={dir} className="mt-4 text-sm text-foreground-soft">
        {t.comments.empty}
      </p>
    );
  }

  return (
    <div lang={locale} dir={dir} className="mt-4 divide-y divide-line">
      {tree.map((comment) => (
        <div key={comment.id} className="py-3 first:pt-0">
          <CommentCard
            comment={comment}
            postId={postId}
            postAuthorId={postAuthorId}
            viewerId={viewerId}
            viewerIsAdmin={viewerIsAdmin}
            canModerate={canModerate}
            onCommentCountChange={onCommentCountChange}
          />
        </div>
      ))}
    </div>
  );
}
