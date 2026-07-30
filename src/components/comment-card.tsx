"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { deleteComment } from "@/app/actions/comments";
import { ReportButton } from "@/components/report-form";
import { CommentComposer } from "@/components/comment-composer";

type CommentData = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null };
};

export function CommentCard({
  comment,
  postId,
  canDelete,
  isReply = false,
  postAuthorId,
}: {
  comment: CommentData;
  postId: string;
  canDelete: boolean;
  isReply?: boolean;
  postAuthorId: string;
}) {
  const [replying, setReplying] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (deleted) return null;

  return (
    <div className={isReply ? "ml-8 mt-3" : "mt-3"}>
      <div className="flex items-center justify-between">
        <Link
          href={`/u/${comment.author.id}`}
          className="text-sm font-semibold hover:text-accent"
        >
          {comment.author.name}
          {comment.author.id === postAuthorId && (
            <span className="ml-1.5 text-xs font-normal text-foreground-soft">
              (author)
            </span>
          )}
        </Link>
        <span className="text-xs text-foreground-soft">
          {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm">{comment.content}</p>
      <div className="mt-1 flex items-center gap-3">
        {!isReply && (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="text-xs text-foreground-soft hover:text-accent"
          >
            Reply
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await deleteComment(comment.id);
                if (!result.error) {
                  setDeleted(true);
                  router.refresh();
                }
              });
            }}
            className="text-xs text-foreground-soft hover:text-danger"
          >
            Delete
          </button>
        )}
        <ReportButton
          targetType="COMMENT"
          targetId={comment.id}
          reportedUserId={comment.author.id}
        />
      </div>
      {replying && (
        <CommentComposer
          postId={postId}
          parentId={comment.id}
          onDone={() => setReplying(false)}
        />
      )}
    </div>
  );
}
