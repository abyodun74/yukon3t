"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { deleteComment, hideComment, toggleCommentReaction } from "@/app/actions/comments";
import { ReportTrigger } from "@/components/report-form";
import { CommentComposer } from "@/components/comment-composer";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { ReactionBar } from "@/components/reaction-bar";
import { UserLink } from "@/components/user-link";
import { isEmojiOnly } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import type { CommentNode } from "@/lib/comment-tree";

// Beyond this depth, replies stop indenting further (they'd otherwise run
// off the edge of the page on a long chain) but stay nested logically.
const MAX_VISUAL_DEPTH = 4;

export function CommentCard({
  comment,
  postId,
  postAuthorId,
  viewerId,
  viewerIsAdmin,
  canModerate,
  depth = 0,
}: {
  comment: CommentNode;
  postId: string;
  postAuthorId: string;
  viewerId: string;
  viewerIsAdmin: boolean;
  canModerate: boolean;
  depth?: number;
}) {
  const [replying, setReplying] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [removed, setRemoved] = useState(comment.moderationStatus === "REMOVED");
  const [reactions, setReactions] = useState(comment.reactions);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (deleted) return null;

  const isOwn = comment.author.id === viewerId;
  const isModerator = postAuthorId === viewerId || viewerIsAdmin || canModerate;
  const canDelete = isOwn || isModerator;
  const canHide = isModerator && !isOwn && !removed;

  function toggleReaction(emoji: string) {
    startTransition(async () => {
      const result = await toggleCommentReaction(comment.id, emoji);
      if (!result.error) setReactions(result.reactions);
    });
  }

  return (
    <div
      className="mt-3"
      style={depth > 0 ? { marginLeft: Math.min(depth, MAX_VISUAL_DEPTH) * 20 } : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <UserLink
            userId={comment.author.id}
            name={comment.author.name}
            username={comment.author.username}
            avatarUrl={comment.author.avatarUrl}
            avatarSize={20}
            className="text-sm font-semibold"
          />
          {comment.author.id === postAuthorId && (
            <span className="text-xs font-normal text-foreground-soft">(author)</span>
          )}
        </div>
        <span className="text-xs text-foreground-soft">
          {formatDistanceToNow(comment.createdAt, { addSuffix: true })}
        </span>
      </div>
      {removed ? (
        <p className="mt-1 text-sm italic text-foreground-soft">This comment was removed.</p>
      ) : (
        <p className={cn("mt-1 whitespace-pre-wrap text-sm", isEmojiOnly(comment.content) && "text-3xl leading-tight")}>
          {comment.content}
        </p>
      )}
      {!removed && (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setReplying((v) => !v)}
              className="text-xs text-foreground-soft hover:text-accent"
            >
              Reply
            </button>
            <EmojiPickerButton onSelect={toggleReaction} />
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
            {canHide && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await hideComment(comment.id);
                    if (!result.error) {
                      setRemoved(true);
                      router.refresh();
                    }
                  });
                }}
                className="text-xs text-foreground-soft hover:text-danger"
                title="Hide this comment as inappropriate — keeps the thread intact for everyone else"
              >
                Hide
              </button>
            )}
            <ReportTrigger
              targetType="COMMENT"
              targetId={comment.id}
              reportedUserId={comment.author.id}
            />
          </div>
          <ReactionBar reactions={reactions} currentUserId={viewerId} onToggle={toggleReaction} />
        </>
      )}
      {replying && (
        <CommentComposer
          postId={postId}
          parentId={comment.id}
          onDone={() => setReplying(false)}
        />
      )}
      {comment.replies.map((reply) => (
        <CommentCard
          key={reply.id}
          comment={reply}
          postId={postId}
          postAuthorId={postAuthorId}
          viewerId={viewerId}
          viewerIsAdmin={viewerIsAdmin}
          canModerate={canModerate}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
