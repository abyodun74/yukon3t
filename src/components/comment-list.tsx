import { CommentCard } from "@/components/comment-card";
import { buildCommentTree, type FlatComment } from "@/lib/comment-tree";

export function CommentList({
  comments,
  postId,
  postAuthorId,
  viewerId,
  viewerIsAdmin,
  canModerate = false,
}: {
  comments: FlatComment[];
  postId: string;
  postAuthorId: string;
  viewerId: string;
  viewerIsAdmin: boolean;
  /** Viewer is the owner/co-admin of the post's Circle (if any). */
  canModerate?: boolean;
}) {
  const tree = buildCommentTree(comments);

  if (tree.length === 0) {
    return (
      <p className="mt-4 text-sm text-foreground-soft">
        No comments yet — be the first to say something.
      </p>
    );
  }

  return (
    <div className="mt-4 divide-y divide-line">
      {tree.map((comment) => (
        <div key={comment.id} className="py-3 first:pt-0">
          <CommentCard
            comment={comment}
            postId={postId}
            postAuthorId={postAuthorId}
            viewerId={viewerId}
            viewerIsAdmin={viewerIsAdmin}
            canModerate={canModerate}
          />
        </div>
      ))}
    </div>
  );
}
