"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Calendar, ExternalLink, Heart, Maximize2, MapPin, MessageSquare, Repeat2, Share2 } from "lucide-react";
import { Lightbox } from "@/components/lightbox";
import { LikersModal } from "@/components/likers-modal";
import { ShareModal } from "@/components/share-modal";
import { toggleLike } from "@/app/actions/likes";
import { editPost } from "@/app/actions/posts";
import { toggleRsvp } from "@/app/actions/rsvp";
import { repost } from "@/app/actions/reposts";
import { cn } from "@/lib/utils";
import { isEmojiOnly } from "@/lib/emoji";
import { PostOptionsMenu } from "@/components/post-options-menu";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { SubscribeButton } from "@/components/subscribe-button";
import { PostConnectPopover } from "@/components/post-connect-popover";
import { TruncatedText } from "@/components/truncated-text";
import { embedSrc, type EmbedProvider } from "@/lib/video-embed";
import { formatDateTime } from "@/lib/format-date";

type MediaType = "NONE" | "IMAGE" | "VIDEO" | "EMBED" | "LINK";

type EmbeddedPost = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  embedProvider: EmbedProvider | null;
  embedId: string | null;
  linkUrl: string | null;
  eventAt: Date | null;
  eventLocation: string | null;
  createdAt: Date;
  editedAt: Date | null;
  author: {
    id: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    trustBand: string;
    openToIntents: string[];
  };
};

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

export type PostCardData = EmbeddedPost & {
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  rsvpCount: number;
  likedByMe: boolean;
  repostedByMe: boolean;
  rsvpGoingByMe: boolean;
  repostOf: EmbeddedPost | null;
  sharedPost: EmbeddedPost | null;
  connectionStatus: ConnectionStatus;
  connectionIsRequester: boolean;
  conversationId: string | null;
  subscribedByMe: boolean;
};

function EventBlock({
  post,
  going,
  rsvpCount,
  isPending,
  onToggle,
}: {
  post: EmbeddedPost;
  going: boolean;
  rsvpCount: number;
  isPending: boolean;
  onToggle: () => void;
}) {
  if (!post.eventAt) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-background px-3 py-2">
      <div className="min-w-0 text-xs text-foreground-soft">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} />
          {/* toLocaleString depends on the runtime's timezone, which differs
              between the server (render) and the browser (hydration) —
              suppressHydrationWarning tells React that's expected here
              rather than a real mismatch; the viewer's own local time
              (post-hydration) is what should win anyway. */}
          <span suppressHydrationWarning>
            {post.eventAt.toLocaleString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        {post.eventLocation && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <MapPin size={13} className="shrink-0" />
            <span className="break-words">{post.eventLocation}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={onToggle}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50",
          going ? "bg-success text-white" : "bg-accent text-accent-ink",
        )}
      >
        {going ? "Going ✓" : "I'm going"}
        {rsvpCount > 0 && <span className="ml-1.5 opacity-80">{rsvpCount}</span>}
      </button>
    </div>
  );
}

function MediaBlock({
  post,
  onOpenImage,
  onOpenVideo,
  editing,
}: {
  post: EmbeddedPost;
  onOpenImage: (index: number) => void;
  onOpenVideo: () => void;
  editing?: {
    draft: string;
    onDraftChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
    error: string | null;
    isPending: boolean;
  };
}) {
  return (
    <>
      {editing ? (
        <div className="mt-2">
          <textarea
            value={editing.draft}
            onChange={(e) => editing.onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                editing.onSave();
              } else if (e.key === "Escape") {
                editing.onCancel();
              }
            }}
            maxLength={50000}
            rows={3}
            autoFocus
            className="w-full resize-none rounded-lg border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          <div className="mt-1 flex items-center justify-end gap-2 text-xs">
            {editing.error && <span className="mr-auto text-danger">{editing.error}</span>}
            <button
              type="button"
              disabled={editing.isPending}
              onClick={editing.onCancel}
              className="rounded-md px-2 py-1 text-foreground-soft hover:bg-line"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={editing.isPending || !editing.draft.trim()}
              onClick={editing.onSave}
              className="rounded-md bg-accent px-2 py-1 font-medium text-accent-ink disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        post.content && (
          <TruncatedText
            text={post.content}
            className={cn("mt-2 whitespace-pre-wrap text-sm", isEmojiOnly(post.content) && "text-4xl leading-tight")}
          />
        )
      )}

      {post.mediaType === "IMAGE" && post.mediaUrls.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-lg",
            post.mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {post.mediaUrls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => onOpenImage(i)}
              className="block cursor-zoom-in"
            >
              {/* Plain <img>, not next/image: avoids routing user-uploaded
                  content through Next's bundled sharp (see SECURITY.md). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="max-h-96 w-full rounded-lg object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {post.mediaType === "VIDEO" && post.videoUrl && (
        <div className="relative mt-3">
          <video
            controls
            preload="metadata"
            poster={post.videoThumbnailUrl ?? undefined}
            className="max-h-96 w-full rounded-lg bg-black"
          >
            <source src={post.videoUrl} />
          </video>
          <button
            type="button"
            onClick={onOpenVideo}
            title="Watch in full screen"
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}

      {post.mediaType === "EMBED" && post.embedProvider && post.embedId && (
        <div className="mt-3 aspect-video overflow-hidden rounded-lg bg-black">
          <iframe
            src={embedSrc({ provider: post.embedProvider, id: post.embedId })}
            title="Embedded video"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}

      {post.mediaType === "LINK" && post.linkUrl && (
        <a
          href={post.linkUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-accent hover:bg-line/40"
        >
          <ExternalLink size={14} className="shrink-0" />
          <span className="truncate">{post.linkUrl}</span>
        </a>
      )}
    </>
  );
}

export function PostCard({
  post,
  viewerId,
  viewerIsAdmin = false,
}: {
  post: PostCardData;
  viewerId: string;
  viewerIsAdmin?: boolean;
}) {
  const displayPost = post.sharedPost ?? post.repostOf ?? post;
  const interactionTargetId = post.sharedPost?.id ?? post.repostOf?.id ?? post.id;

  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [shareCount, setShareCount] = useState(post.shareCount);
  const [going, setGoing] = useState(post.rsvpGoingByMe);
  const [rsvpCount, setRsvpCount] = useState(post.rsvpCount);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [isLikePending, startLikeTransition] = useTransition();
  const [isRepostPending, startRepostTransition] = useTransition();
  const [isRsvpPending, startRsvpTransition] = useTransition();

  // post.content/editedAt (this row's own text — the repost caption when
  // it's a repost, otherwise the post body) shadowed in local state so an
  // edit updates in place without a full server round-trip re-render.
  const [content, setContent] = useState(post.content);
  const [editedAt, setEditedAt] = useState(post.editedAt);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(post.content);
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditPending, startEditTransition] = useTransition();
  const canEdit = viewerId === post.author.id;

  function startEditing() {
    setEditDraft(content);
    setEditError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditDraft(content);
    setEditError(null);
  }

  function saveEdit() {
    const text = editDraft.trim();
    if (!text || isEditPending) return;
    setEditError(null);
    startEditTransition(async () => {
      const fd = new FormData();
      fd.set("content", text);
      const result = await editPost(post.id, fd);
      if (result.error || !result.post) {
        setEditError("Couldn't save that edit.");
        return;
      }
      setContent(result.post.content);
      setEditedAt(result.post.editedAt);
      setEditing(false);
    });
  }

  function handleLike() {
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    startLikeTransition(async () => {
      const result = await toggleLike(interactionTargetId);
      if (result.error) {
        setLiked(!nextLiked);
        setLikeCount((c) => c + (nextLiked ? -1 : 1));
      }
    });
  }

  function handleRsvp() {
    const nextGoing = !going;
    setGoing(nextGoing);
    setRsvpCount((c) => c + (nextGoing ? 1 : -1));
    startRsvpTransition(async () => {
      const result = await toggleRsvp(interactionTargetId);
      if (result.error) {
        setGoing(!nextGoing);
        setRsvpCount((c) => c + (nextGoing ? -1 : 1));
      }
    });
  }

  function handleRepost() {
    const nextReposted = !reposted;
    setReposted(nextReposted);
    setRepostCount((c) => c + (nextReposted ? 1 : -1));
    startRepostTransition(async () => {
      const fd = new FormData();
      fd.set("postId", interactionTargetId);
      const result = await repost(fd);
      if (result.error) {
        setReposted(!nextReposted);
        setRepostCount((c) => c + (nextReposted ? -1 : 1));
      }
    });
  }

  const isQuoting = Boolean(post.repostOf || post.sharedPost);

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      {(post.repostOf || post.sharedPost) && (
        <Link
          href={`/u/${post.author.id}`}
          className="mb-2 flex items-center gap-1.5 text-xs text-foreground-soft hover:text-accent"
        >
          {post.repostOf ? <Repeat2 size={14} /> : <Share2 size={14} />}
          {post.repostOf ? "Reposted by" : "Shared by"}{" "}
          <span className="font-medium">{post.author.name}</span>
        </Link>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserLink
            userId={displayPost.author.id}
            name={displayPost.author.name}
            username={displayPost.author.username}
            avatarUrl={displayPost.author.avatarUrl}
            className="text-sm font-semibold"
          />
          <TrustBadge band={displayPost.author.trustBand} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* toLocaleString depends on the runtime's timezone, which
              differs between the server (render) and the browser
              (hydration) — suppressHydrationWarning tells React that's
              expected here rather than a real mismatch to warn about. */}
          {editedAt && <span className="text-xs text-foreground-soft">Edited</span>}
          <span className="text-xs text-foreground-soft" suppressHydrationWarning>
            {formatDateTime(displayPost.createdAt)}
          </span>
          <PostOptionsMenu
            postId={post.id}
            canEdit={canEdit}
            canDelete={viewerId === post.author.id || viewerIsAdmin}
            canReport={viewerId !== displayPost.author.id}
            reportTargetId={interactionTargetId}
            reportedUserId={displayPost.author.id}
            onEdit={startEditing}
          />
        </div>
      </div>

      {isQuoting && (editing || content) && (
        editing ? (
          <div className="mt-2">
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  cancelEdit();
                }
              }}
              maxLength={50000}
              rows={2}
              autoFocus
              className="w-full resize-none rounded-lg border border-line bg-background px-2 py-1.5 text-sm italic outline-none focus:border-accent"
            />
            <div className="mt-1 flex items-center justify-end gap-2 text-xs">
              {editError && <span className="mr-auto text-danger">{editError}</span>}
              <button
                type="button"
                disabled={isEditPending}
                onClick={cancelEdit}
                className="rounded-md px-2 py-1 text-foreground-soft hover:bg-line"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isEditPending || !editDraft.trim()}
                onClick={saveEdit}
                className="rounded-md bg-accent px-2 py-1 font-medium text-accent-ink disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <TruncatedText
            text={content}
            className="mt-2 whitespace-pre-wrap text-sm italic text-foreground-soft"
          />
        )
      )}

      <EventBlock
        post={displayPost}
        going={going}
        rsvpCount={rsvpCount}
        isPending={isRsvpPending}
        onToggle={handleRsvp}
      />

      <MediaBlock
        post={isQuoting ? displayPost : { ...displayPost, content }}
        onOpenImage={(index) => setLightboxIndex(index)}
        onOpenVideo={() => setLightboxVideo(true)}
        editing={
          !isQuoting && editing
            ? {
                draft: editDraft,
                onDraftChange: setEditDraft,
                onSave: saveEdit,
                onCancel: cancelEdit,
                error: editError,
                isPending: isEditPending,
              }
            : undefined
        }
      />

      <div className="mt-3 flex items-center gap-5 border-t border-line pt-2 text-xs text-foreground-soft">
        <span className={cn("flex items-center gap-1.5", liked && "text-danger")}>
          <button
            type="button"
            disabled={isLikePending}
            onClick={handleLike}
            className="flex items-center hover:text-danger"
          >
            <Heart size={16} fill={liked ? "currentColor" : "none"} />
          </button>
          {likeCount > 0 && (
            <button
              type="button"
              onClick={() => setLikersOpen(true)}
              className="hover:text-danger hover:underline"
            >
              {likeCount}
            </button>
          )}
        </span>

        <Link
          href={`/post/${interactionTargetId}`}
          className="flex items-center gap-1.5 hover:text-accent"
        >
          <MessageSquare size={16} />
          {post.commentCount > 0 && post.commentCount}
        </Link>

        <button
          type="button"
          disabled={isRepostPending}
          onClick={handleRepost}
          className={cn(
            "flex items-center gap-1.5 hover:text-success",
            reposted && "text-success",
          )}
        >
          <Repeat2 size={16} />
          {repostCount > 0 && repostCount}
        </button>

        <button
          type="button"
          onClick={() => setShareModalOpen(true)}
          className="flex items-center gap-1.5 hover:text-accent"
        >
          <Share2 size={16} />
          {shareCount > 0 && shareCount}
        </button>

        {viewerId !== displayPost.author.id && (
          <>
            <PostConnectPopover
              targetId={displayPost.author.id}
              openToIntents={displayPost.author.openToIntents}
              status={post.connectionStatus}
              isRequester={post.connectionIsRequester}
              conversationId={post.conversationId}
            />
            <SubscribeButton
              targetId={displayPost.author.id}
              initiallySubscribed={post.subscribedByMe}
              variant="icon"
            />
          </>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={displayPost.mediaUrls}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      {lightboxVideo && displayPost.videoUrl && (
        <Lightbox video={displayPost.videoUrl} onClose={() => setLightboxVideo(false)} />
      )}
      {likersOpen && (
        <LikersModal postId={interactionTargetId} onClose={() => setLikersOpen(false)} />
      )}
      {shareModalOpen && (
        <ShareModal
          postId={interactionTargetId}
          content={displayPost.content}
          mediaType={displayPost.mediaType}
          mediaUrls={displayPost.mediaUrls}
          videoUrl={displayPost.videoUrl}
          onClose={() => setShareModalOpen(false)}
          onShareCountChange={setShareCount}
        />
      )}
    </div>
  );
}
