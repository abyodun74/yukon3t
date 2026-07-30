import { CommentCard } from "@/components/comment-card";

type CommentData = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null };
  replies: {
    id: string;
    content: string;
    createdAt: Date;
    author: { id: string; name: string | null };
  }[];
};

export function CommentList({
  comments,
  postId,
  postAuthorId,
  viewerId,
  viewerIsAdmin,
}: {
  comments: CommentData[];
  postId: string;
  postAuthorId: string;
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  if (comments.length === 0) {
    return (
      <p className="mt-4 text-sm text-foreground-soft">
        No comments yet — be the first to say something.
      </p>
    );
  }

  function canDelete(authorId: string) {
    return authorId === viewerId || postAuthorId === viewerId || viewerIsAdmin;
  }

  return (
    <div className="mt-4 divide-y divide-line">
      {comments.map((comment) => (
        <div key={comment.id} className="py-3 first:pt-0">
          <CommentCard
            comment={comment}
            postId={postId}
            postAuthorId={postAuthorId}
            canDelete={canDelete(comment.author.id)}
          />
          {comment.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              postId={postId}
              postAuthorId={postAuthorId}
              canDelete={canDelete(reply.author.id)}
              isReply
            />
          ))}
        </div>
      ))}
    </div>
  );
}
