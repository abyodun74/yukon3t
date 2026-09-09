"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Calendar, ExternalLink, Heart, Maximize2, MapPin, MessageSquare, Repeat2, Share2, Volume2, VolumeX } from "lucide-react";
import { Lightbox } from "@/components/lightbox";
import { LikersModal } from "@/components/likers-modal";
import { ShareModal } from "@/components/share-modal";
import { toggleLike, togglePostReaction } from "@/app/actions/likes";
import { editPost } from "@/app/actions/posts";
import { toggleRsvp } from "@/app/actions/rsvp";
import { repost } from "@/app/actions/reposts";
import { getPostComments } from "@/app/actions/comments";
import { cn } from "@/lib/utils";
import { isEmojiOnly } from "@/lib/emoji";
import { PostOptionsMenu } from "@/components/post-options-menu";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { SubscribeButton } from "@/components/subscribe-button";
import { PostConnectPopover } from "@/components/post-connect-popover";
import { TruncatedText } from "@/components/truncated-text";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import { ReactionBar } from "@/components/reaction-bar";
import { CommentComposer } from "@/components/comment-composer";
import { CommentList } from "@/components/comment-list";
import { embedSrc, type EmbedProvider } from "@/lib/video-embed";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { formatDateTime } from "@/lib/format-date";
import { useAutoplayOnView } from "@/lib/use-autoplay-on-view";
import { useFeedVideoMuted } from "@/lib/feed-video-mute";
import type { FlatComment } from "@/lib/comment-tree";

type MediaType = "NONE" | "IMAGE" | "VIDEO" | "EMBED" | "LINK" | "GIF";

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
  reactions: { emoji: string; userId: string }[];
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
  const videoRef = useAutoplayOnView<HTMLVideoElement>();
  const [muted, setMuted] = useFeedVideoMuted();
  // The `muted` JSX prop only reliably applies at mount — once a WebView
  // video is already playing, toggling it doesn't flip the element's live
  // audio output (the icon/UI updates, but sound never actually changes).
  // Setting the DOM property directly is the correct, standard fix.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, videoRef]);
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
                alt={post.content || `Photo posted by ${post.author.name}`}
                className="max-h-96 w-full rounded-lg object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {post.mediaType === "GIF" && post.mediaUrls.length > 0 && (
        <button type="button" onClick={() => onOpenImage(0)} className="mt-3 block w-full cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy-hosted GIF, not a local/optimizable asset */}
          <img
            src={post.mediaUrls[0]}
            alt={post.content || `GIF posted by ${post.author.name}`}
            className="max-h-96 w-full rounded-lg object-cover"
            loading="lazy"
          />
        </button>
      )}

      {post.mediaType === "VIDEO" && post.videoUrl && (
        <div className="relative mt-3">
          <video
            ref={videoRef}
            muted={muted}
            loop
            playsInline
            preload="metadata"
            poster={post.videoThumbnailUrl ?? undefined}
            // Edge-to-edge and tall (Instagram feed video convention), not
            // capped/boxed — native browser `controls` (a scrubber/volume
            // slider) are deliberately omitted in favor of just the sound
            // toggle below, matching that same reference. Tapping the video
            // itself toggles play/pause since there's no scrubber to do it.
            className="aspect-[4/5] w-full cursor-pointer bg-black object-cover"
            onClick={(e) => {
              const el = e.currentTarget;
              if (el.paused) el.play().catch(() => {});
              else el.pause();
            }}
          >
            <source src={post.videoUrl} />
          </video>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMuted(!muted);
            }}
            title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute" : "Mute"}
            className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
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
  const [reactions, setReactions] = useState(post.reactions);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [shareCount, setShareCount] = useState(post.shareCount);
  const [going, setGoing] = useState(post.rsvpGoingByMe);
  const [rsvpCount, setRsvpCount] = useState(post.rsvpCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [isLikePending, startLikeTransition] = useTransition();
  const [, startReactionTransition] = useTransition();
  const [isRepostPending, startRepostTransition] = useTransition();
  const [isRsvpPending, startRsvpTransition] = useTransition();

  // Inline comments — expanding these fetches on demand (not server-
  // rendered as part of Home/Circles' own page data) so commenting or
  // reading replies never requires navigating away to /post/[id]. `comments
  // === null` means "not fetched yet", distinct from an empty published
  // list, so re-expanding after a collapse doesn't refetch unnecessarily.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FlatComment[] | null>(null);
  const [commentsError, setCommentsError] = useState(false);
  const [commentsCanModerate, setCommentsCanModerate] = useState(false);
  const [isCommentsPending, startCommentsTransition] = useTransition();

  function loadComments() {
    setCommentsError(false);
    startCommentsTransition(async () => {
      const result = await getPostComments(interactionTargetId);
      if (result.error) {
        setCommentsError(true);
        return;
      }
      setComments(result.comments);
      setCommentsCanModerate(result.canModerate);
    });
  }

  function toggleComments() {
    const opening = !commentsOpen;
    setCommentsOpen(opening);
    if (opening && comments === null) loadComments();
  }

  // Shared by the top-level composer (always +1) and anything deeper in the
  // tree (CommentList threads this through as onCommentCountChange — +1 for
  // a reply, a negative delta for a delete/hide) so the action row's badge
  // and the actual list stay in sync no matter where in the tree a change
  // happened, without leaving Home to see it reflected.
  function handleCommentCountChange(delta: number) {
    setCommentCount((c) => c + delta);
    loadComments();
  }

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

  function toggleReaction(emoji: string) {
    startReactionTransition(async () => {
      const result = await togglePostReaction(interactionTargetId, emoji);
      if (!result.error) setReactions(result.reactions);
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
  // Content-adaptive density: a plain text update carries far less visual
  // weight than a photo/video/event, so it gets a tighter card instead of
  // the same padding a media post needs to breathe. Reposts/shares keep
  // the full treatment regardless — the "Reposted by" line already makes
  // those cards busier than a plain text post, adaptive density on top of
  // that would just look inconsistent.
  const isCompact = !isQuoting && displayPost.mediaType === "NONE" && !displayPost.eventAt;

  return (
    <div
      className={cn(
        "animate-rise-in rounded-xl border border-line bg-surface shadow-[var(--shadow-sm)]",
        isCompact ? "p-3" : "p-4",
      )}
    >
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

      <div
        className={cn(
          "flex items-center gap-5 text-xs text-foreground-soft",
          isCompact ? "mt-2 pt-1" : "mt-3 border-t border-line pt-2",
        )}
      >
        <span className={cn("flex items-center gap-1.5", liked && "text-danger")}>
          <button
            type="button"
            disabled={isLikePending}
            onClick={handleLike}
            aria-label={liked ? "Unlike" : "Like"}
            className="flex items-center p-2 -m-2 hover:text-danger"
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

        <EmojiPickerButton onSelect={toggleReaction} quickReactions={QUICK_REACTIONS} />

        <button
          type="button"
          onClick={toggleComments}
          aria-expanded={commentsOpen}
          aria-label={commentsOpen ? "Hide comments" : "Comment"}
          className={cn("flex items-center gap-1.5 p-2 -m-2 hover:text-accent", commentsOpen && "text-accent")}
        >
          <MessageSquare size={16} />
          {commentCount > 0 && commentCount}
        </button>

        <button
          type="button"
          disabled={isRepostPending}
          onClick={handleRepost}
          aria-label={reposted ? "Undo repost" : "Repost"}
          className={cn(
            "flex items-center gap-1.5 p-2 -m-2 hover:text-success",
            reposted && "text-success",
          )}
        >
          <Repeat2 size={16} />
          {repostCount > 0 && repostCount}
        </button>

        <button
          type="button"
          onClick={() => setShareModalOpen(true)}
          aria-label="Share"
          className="flex items-center gap-1.5 p-2 -m-2 hover:text-accent"
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

      <ReactionBar reactions={reactions} currentUserId={viewerId} onToggle={toggleReaction} />

      {commentsOpen && (
        <div className="mt-3 border-t border-line pt-3">
          <CommentComposer
            postId={interactionTargetId}
            onDone={() => handleCommentCountChange(1)}
          />
          {isCommentsPending && comments === null && (
            <p className="mt-3 animate-loading-pulse text-xs text-foreground-soft">Loading comments...</p>
          )}
          {commentsError && (
            <p className="mt-3 text-xs text-danger">Couldn&apos;t load comments — try again.</p>
          )}
          {comments && (
            <CommentList
              comments={comments}
              postId={interactionTargetId}
              postAuthorId={displayPost.author.id}
              viewerId={viewerId}
              viewerIsAdmin={viewerIsAdmin}
              canModerate={commentsCanModerate}
              onCommentCountChange={handleCommentCountChange}
            />
          )}
        </div>
      )}

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
