"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Eye, Trash2, Send, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserLink, UserAvatar } from "@/components/user-link";
import {
  viewStory,
  deleteStory,
  getStoryViewers,
  getStoryReactionSummary,
  toggleStoryReaction,
  replyToStory,
  getStoryComments,
  createStoryComment,
  deleteStoryComment,
} from "@/app/actions/stories";
import { StoryShareButton } from "@/components/story-share-button";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { formatDateTime } from "@/lib/format-date";
import { useScreenshotContext } from "@/lib/screenshot-context";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { EmojiPickerButton } from "@/components/emoji-picker-button";

type StoryComment = {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string | null; avatarUrl: string | null };
};

const IMAGE_DURATION_MS = 5000;
const TAP_MAX_HOLD_MS = 250;
// A pointer that moved at least this far horizontally before release is a
// swipe (move to the next/previous person's stack), not a tap (move within
// this person's own stories) — checked before the hold-duration tap check
// below, so a slow drag doesn't get misread as a hold-to-pause release.
const SWIPE_THRESHOLD_PX = 60;

export type StoryData = {
  id: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  mediaThumbnailUrl: string | null;
  caption: string | null;
  createdAt: Date;
  viewCount: number;
  // Set when this story is a "share to your story" of an existing post
  // (actions/shares.ts's shareToStory) — renders a "View post" link back to
  // it, the same attribution repost/shareToCircle already give a quoted post.
  sharedPostId: string | null;
};

function timeAgo(date: Date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(diffMs / 60_000))}m`;
  return `${hours}h`;
}

/**
 * Reserves real space below whatever's the bottom-most interactive element
 * in this viewer (the comment icon, reply bar, "Seen by" list, ...) for
 * Android's on-screen navigation bar/gesture pill. This viewer is a fixed
 * inset-0 overlay with edge-to-edge WebView content, so without this the
 * system nav can sit directly on top of — and swallow taps on — anything
 * rendered flush against the true bottom edge of the screen; confirmed
 * live, the new comment icon was invisible/untappable behind it. Same fix
 * shape as nav.tsx's own bottom tab bar, including its fallback: plain
 * env(safe-area-inset-bottom) alone has a known Android reliability gap,
 * so this also falls back to --safe-area-inset-bottom, which Capacitor
 * core's SystemBars plugin injects straight from Android's real
 * WindowInsets. No-op (0px) anywhere neither is set, including iOS/web.
 */
function SafeAreaBottomSpacer() {
  return <div aria-hidden style={{ height: "max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px))" }} />;
}

/**
 * Full-screen Instagram-style story viewer: one segmented progress bar per
 * story, images auto-advance on a timer, videos advance on `ended`, and
 * holding anywhere pauses without navigating (a genuine tap — released
 * within TAP_MAX_HOLD_MS — is what advances/rewinds).
 */
export function StoryViewer({
  stories,
  startIndex,
  authorId,
  authorName,
  authorAvatarUrl,
  isOwner,
  currentUserId,
  onClose,
  direction,
  onNextAuthor,
  onPrevAuthor,
}: {
  stories: StoryData[];
  startIndex: number;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isOwner: boolean;
  /** Used only to decide whether to show a delete button on a comment (a UX nicety) — deleteStoryComment re-checks authorship server-side regardless. */
  currentUserId: string;
  onClose: () => void;
  /** Which way this mount should glide in from — set by the tray wrapper alongside onNextAuthor/onPrevAuthor. Omitted (e.g. a single-author profile viewer) means no entrance glide. */
  direction?: "next" | "prev";
  /** A swipe (see SWIPE_THRESHOLD_PX), or naturally reaching the end of `stories`, calls this instead of onClose when provided — the tray wrapper uses it to move to the next person's stack rather than exiting. */
  onNextAuthor?: () => void;
  /** A rightward swipe calls this when provided — the tray wrapper uses it to move to the previous person's stack. No-op (not undefined-guarded to onClose) if there's nobody before this one. */
  onPrevAuthor?: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  // Keyed by story id rather than plain booleans — switching stories then
  // naturally "resets" these (the id no longer matches) without needing an
  // effect to synchronously reset state on every story change.
  const [deleteConfirmForId, setDeleteConfirmForId] = useState<string | null>(null);
  const [viewersOpenForId, setViewersOpenForId] = useState<string | null>(null);
  const [viewers, setViewers] = useState<
    { id: string; name: string; viewedAt: Date; reaction: string | null }[] | null
  >(null);
  const [isPending, setIsPending] = useState(false);
  const [reactionCounts, setReactionCounts] = useState<{ emoji: string; count: number }[]>([]);
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [commentsOpenForId, setCommentsOpenForId] = useState<string | null>(null);
  const [comments, setComments] = useState<StoryComment[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const elapsedRef = useRef(0);
  const seenRef = useRef<Set<string>>(new Set());
  const pointerDownAtRef = useRef(0);
  const pointerStartXRef = useRef(0);
  const router = useRouter();

  const story = stories[index];
  useScreenshotContext(story ? { type: "story", id: story.id } : null);
  const showViewers = story ? viewersOpenForId === story.id : false;
  const showComments = story ? commentsOpenForId === story.id : false;
  const confirmingDelete = story ? deleteConfirmForId === story.id : false;

  // Checks the boundary against `index` directly and calls onClose as a
  // plain function call, rather than from inside setIndex's updater — the
  // updater can run synchronously as part of applying this component's own
  // state update, and calling a different component's setState from within
  // it (onClose ultimately updates StoryTrayViewer/StoryTray's state) is
  // exactly what React's "Cannot update a component while rendering a
  // different component" warning flags.
  const next = useCallback(() => {
    if (index + 1 >= stories.length) {
      if (onNextAuthor) onNextAuthor();
      else onClose();
      return;
    }
    setIndex(index + 1);
  }, [index, stories.length, onClose, onNextAuthor]);

  const prev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Pauses whatever else was playing behind this full-screen viewer (a feed
  // video, another Muse upload) for as long as it's open, and resumes it on
  // close — same reference-counted guard the call frames use. Runs once for
  // the whole viewer's lifetime, not per-story: switching between this
  // person's own stories (index changes, component stays mounted) must not
  // release-then-reacquire the guard, which would incorrectly resume
  // whatever was paused before this viewer ever opened.
  useEffect(() => {
    pauseAllPlayingVideos();
    return () => resumePausedVideos();
  }, []);

  // Records a view once per story — the timer effect below is what actually
  // (re)starts progress from 0 for the new story, via its own rAF/video
  // callbacks rather than a synchronous setState here.
  useEffect(() => {
    if (!story) return;
    elapsedRef.current = 0;
    if (!seenRef.current.has(story.id)) {
      seenRef.current.add(story.id);
      viewStory(story.id);
    }
  }, [story]);

  // Loads this story's reaction counts fresh each time it becomes current —
  // an async fetch resolved in a .then(), not a synchronous reset, so it
  // doesn't hit the same "setState directly in an effect body" issue the
  // viewers/delete-confirm state avoids via id-keying above.
  useEffect(() => {
    if (!story) return;
    let cancelled = false;
    getStoryReactionSummary(story.id).then((result) => {
      if (cancelled || result.error) return;
      setReactionCounts(result.summary);
      setMyReaction(result.mine);
    });
    return () => {
      cancelled = true;
    };
  }, [story]);

  // Image auto-advance timer — videos drive their own progress via onTimeUpdate/onEnded below.
  useEffect(() => {
    if (!story || story.mediaType !== "IMAGE" || paused || showViewers || showComments) return undefined;

    let raf: number;
    let lastTs = performance.now();
    const tick = (ts: number) => {
      elapsedRef.current += ts - lastTs;
      lastTs = ts;
      const pct = Math.min(1, elapsedRef.current / IMAGE_DURATION_MS);
      setProgress(pct);
      if (pct >= 1) {
        next();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [story, paused, showViewers, showComments, next]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || story?.mediaType !== "VIDEO") return;
    if (paused || showViewers || showComments) video.pause();
    else video.play().catch(() => {});
  }, [paused, showViewers, showComments, story]);

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    pointerDownAtRef.current = Date.now();
    pointerStartXRef.current = e.clientX;
    setPaused(true);
  }

  function handlePointerUp(e: PointerEvent<HTMLButtonElement>, tapDirection: "prev" | "next") {
    const held = Date.now() - pointerDownAtRef.current;
    const deltaX = e.clientX - pointerStartXRef.current;
    setPaused(false);

    // A real horizontal swipe always means "move between people", regardless
    // of which tap zone (left third vs right two-thirds) it started or ended
    // in and regardless of which story is currently showing — this is what
    // makes it read as distinct from a tap, which only steps through this
    // same person's own stories.
    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX) {
      if (deltaX < 0) onNextAuthor?.();
      else onPrevAuthor?.();
      return;
    }

    if (held < TAP_MAX_HOLD_MS) {
      if (tapDirection === "prev") prev();
      else next();
    }
  }

  async function handleReact(emoji: string) {
    if (!story) return;
    const result = await toggleStoryReaction(story.id, emoji);
    if (!result.error) {
      setReactionCounts(result.summary);
      setMyReaction(result.mine);
    }
  }

  async function loadViewers() {
    if (!story) return;
    setPaused(true);
    setCommentsOpenForId(null);
    setViewersOpenForId(story.id);
    const result = await getStoryViewers(story.id);
    setViewers(result.viewers);
  }

  async function loadComments() {
    if (!story) return;
    setPaused(true);
    setViewersOpenForId(null);
    setCommentsOpenForId(story.id);
    const result = await getStoryComments(story.id);
    setComments(result.comments);
  }

  async function handlePostComment(content: string) {
    if (!story) return false;
    const fd = new FormData();
    fd.set("content", content);
    const result = await createStoryComment(story.id, fd);
    if (result.error || !result.comment) return false;
    setComments((prev) => [...(prev ?? []), result.comment as StoryComment]);
    return true;
  }

  async function handleDeleteComment(commentId: string) {
    const result = await deleteStoryComment(commentId);
    if (!result.error) {
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
    }
  }

  async function handleDelete() {
    if (!story || isPending) return;
    setIsPending(true);
    await deleteStory(story.id);
    setIsPending(false);
    router.refresh();
    if (stories.length <= 1) {
      onClose();
    } else {
      next();
    }
  }

  if (!story) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[70] overflow-hidden bg-black",
        direction === "next" && "story-glide-next",
        direction === "prev" && "story-glide-prev",
      )}
    >
      <div key={story.id} className="story-media-in absolute inset-0 flex items-center justify-center">
        {story.mediaType === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.mediaUrl} alt={`Story by ${authorName}`} className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            src={story.mediaUrl}
            poster={story.mediaThumbnailUrl ?? undefined}
            autoPlay
            playsInline
            className="max-h-full max-w-full object-contain"
            onTimeUpdate={(e) => {
              const el = e.currentTarget;
              if (el.duration) setProgress(el.currentTime / el.duration);
            }}
            onEnded={next}
          />
        )}
      </div>

      {/* Tap zones — sit above the media, below the header/caption chrome. */}
      <div className="absolute inset-0 z-10 flex">
        <button
          type="button"
          aria-label="Previous story"
          className="h-full w-1/3"
          onPointerDown={handlePointerDown}
          onPointerUp={(e) => handlePointerUp(e, "prev")}
          onPointerLeave={() => setPaused(false)}
        />
        <button
          type="button"
          aria-label="Next story"
          className="h-full w-2/3"
          onPointerDown={handlePointerDown}
          onPointerUp={(e) => handlePointerUp(e, "next")}
          onPointerLeave={() => setPaused(false)}
        />
      </div>

      <div className="absolute inset-x-0 top-0 z-20 p-3">
        <div className="flex gap-1">
          {stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white"
                style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserLink
              userId={authorId}
              name={authorName}
              avatarUrl={authorAvatarUrl}
              avatarSize={28}
              showUsername={false}
              className="text-sm font-medium text-white hover:text-white/80"
            />
            <span className="text-xs text-white/70" title={formatDateTime(story.createdAt)}>
              {timeAgo(story.createdAt)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {isOwner && (
              <button
                type="button"
                onClick={() => setDeleteConfirmForId((id) => (id === story.id ? null : story.id))}
                aria-label="Delete story"
                className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-white/80 hover:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </div>

      {confirmingDelete && (
        <div className="absolute inset-x-0 top-16 z-30 mx-3 flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
          <span>Delete this story?</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setDeleteConfirmForId(null)}
              className="rounded-md border border-line px-2 py-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="rounded-md bg-danger px-2 py-1 font-medium text-white disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/*
        Everything below is one flowing bottom stack per branch (owner vs
        viewer), not several independently `absolute bottom-0` siblings —
        that used to make the caption, reaction badges, and reply bar all
        anchor to the exact same spot and render on top of each other
        instead of pushing one another apart.
      */}
      {isOwner ? (
        <div className="absolute inset-x-0 bottom-0 z-20">
          {showViewers ? (
            <div className="max-h-64 overflow-y-auto rounded-t-2xl bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
                  Seen by {viewers?.length ?? 0}
                </p>
                <button type="button" onClick={() => setViewersOpenForId(null)} className="text-foreground-soft">
                  <X size={16} />
                </button>
              </div>
              <ul className="mt-2 space-y-1.5">
                {(viewers ?? []).map((v) => (
                  <li key={v.id} className="flex items-center justify-between text-sm">
                    <span>{v.name}</span>
                    {v.reaction && <span>{v.reaction}</span>}
                  </li>
                ))}
                {viewers?.length === 0 && (
                  <li className="text-sm text-foreground-soft">No views yet.</li>
                )}
              </ul>
              <SafeAreaBottomSpacer />
            </div>
          ) : showComments ? (
            <StoryCommentsPanel
              comments={comments}
              currentUserId={currentUserId}
              isStoryOwner
              onClose={() => setCommentsOpenForId(null)}
              onPost={handlePostComment}
              onDelete={handleDeleteComment}
            />
          ) : (
            <div className="bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
              {story.caption && <p className="break-words text-sm text-white">{story.caption}</p>}
              {story.sharedPostId && (
                <Link
                  href={`/post/${story.sharedPostId}`}
                  className="mt-1 inline-block text-xs font-medium text-white underline underline-offset-2"
                >
                  View post
                </Link>
              )}
              {reactionCounts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {reactionCounts.map((r) => (
                    <span
                      key={r.emoji}
                      className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white"
                    >
                      {r.emoji} {r.count}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadViewers}
                  className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  <Eye size={14} />
                  {story.viewCount}
                </button>
                <button
                  type="button"
                  onClick={loadComments}
                  className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white"
                >
                  <MessageCircle size={14} />
                  Comments
                </button>
                <StoryShareButton storyId={story.id} onOpenChange={setPaused} />
              </div>
              <SafeAreaBottomSpacer />
            </div>
          )}
        </div>
      ) : showComments ? (
        <div className="absolute inset-x-0 bottom-0 z-20">
          <StoryCommentsPanel
            comments={comments}
            currentUserId={currentUserId}
            isStoryOwner={false}
            onClose={() => setCommentsOpenForId(null)}
            onPost={handlePostComment}
            onDelete={handleDeleteComment}
          />
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10">
          {story.caption && <p className="mb-2 break-words text-sm text-white">{story.caption}</p>}
          {story.sharedPostId && (
            <Link
              href={`/post/${story.sharedPostId}`}
              className="mb-2 inline-block text-xs font-medium text-white underline underline-offset-2"
            >
              View post
            </Link>
          )}
          {reactionCounts.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {reactionCounts.map((r) => (
                <span
                  key={r.emoji}
                  className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs text-white"
                >
                  {r.emoji} {r.count}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleReact(emoji)}
                className={`rounded-full px-2 py-1 text-lg ${
                  myReaction === emoji ? "bg-white/30" : "bg-black/30 hover:bg-white/20"
                }`}
              >
                {emoji}
              </button>
            ))}
            {/* + opens the full emoji picker for anything beyond the six quick reactions; the story pauses while it's open. */}
            <EmojiPickerButton
              triggerVariant="plus"
              triggerClassName="rounded-full bg-black/30 p-2 text-white hover:bg-white/20"
              popupZClass="z-[80]"
              onOpenChange={setPaused}
              onSelect={handleReact}
            />
            <button
              type="button"
              onClick={loadComments}
              aria-label="Comments"
              className="rounded-full bg-black/30 p-2 text-white hover:bg-white/20"
            >
              <MessageCircle size={16} />
            </button>
            <StoryShareButton storyId={story.id} onOpenChange={setPaused} />
          </div>
          <div className="mt-2">
            <StoryReplyBar
              key={story.id}
              storyId={story.id}
              authorName={authorName}
              onFocusChange={setPaused}
            />
          </div>
          <SafeAreaBottomSpacer />
        </div>
      )}
    </div>
  );
}

/**
 * Public comment thread — distinct from StoryReplyBar below, which sends a
 * private DM. Shown as a bottom sheet for both the story's owner and any
 * viewer, same shape as the owner-only "Seen by" panel above it in the JSX.
 */
function StoryCommentsPanel({
  comments,
  currentUserId,
  isStoryOwner,
  onClose,
  onPost,
  onDelete,
}: {
  comments: StoryComment[] | null;
  currentUserId: string;
  isStoryOwner: boolean;
  onClose: () => void;
  onPost: (content: string) => Promise<boolean>;
  onDelete: (commentId: string) => void;
}) {
  const [text, setText] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState(false);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || isPosting) return;
    setIsPosting(true);
    setError(false);
    const ok = await onPost(trimmed);
    setIsPosting(false);
    if (ok) setText("");
    else setError(true);
  }

  return (
    <div className="flex max-h-[70vh] flex-col rounded-t-2xl bg-surface p-4">
      <div className="flex shrink-0 items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
          Comments{comments ? ` (${comments.length})` : ""}
        </p>
        <button type="button" onClick={onClose} aria-label="Close comments" className="text-foreground-soft">
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 flex-1 space-y-3 overflow-y-auto">
        {comments === null && <li className="text-sm text-foreground-soft">Loading…</li>}
        {comments?.length === 0 && <li className="text-sm text-foreground-soft">No comments yet.</li>}
        {comments?.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <UserAvatar avatarUrl={c.author.avatarUrl} name={c.author.name} size={28} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm">
                <span className="font-medium">{c.author.name ?? "Someone"}</span>{" "}
                {c.content}
              </p>
              <p className="text-[11px] text-foreground-soft">{timeAgo(c.createdAt)}</p>
            </div>
            {(c.author.id === currentUserId || isStoryOwner) && (
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label="Delete comment"
                className="shrink-0 p-1 text-foreground-soft hover:text-danger"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          maxLength={1000}
          placeholder="Add a comment..."
          className="flex-1 rounded-full border border-line bg-background px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={!text.trim() || isPosting}
          onClick={send}
          aria-label="Post comment"
          className="shrink-0 rounded-full bg-accent p-2 text-accent-ink disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">Couldn&apos;t post that comment.</p>}
      <SafeAreaBottomSpacer />
    </div>
  );
}

function replyErrorMessage(code: string) {
  switch (code) {
    case "not_connected":
      return "Connect with them first to reply to their story.";
    case "blocked":
      return "This reply couldn't be sent.";
    case "secret_chat":
      return "You have a secret chat with them — send your reply from that chat so it stays encrypted.";
    case "rate_limited":
      return "Slow down a little.";
    case "not_found":
      return "This story is no longer available.";
    default:
      return "Couldn't send that reply — try again.";
  }
}

/**
 * Owns its own draft/status state, keyed by story id from the parent — so
 * switching stories naturally clears any in-progress draft via remount
 * instead of an effect resetting it (see the id-keyed viewer/delete state
 * above for the same reasoning).
 */
function StoryReplyBar({
  storyId,
  authorName,
  onFocusChange,
}: {
  storyId: string;
  authorName: string;
  onFocusChange: (focused: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || status === "sending") return;
    setStatus("sending");
    setErrorMsg(null);
    const fd = new FormData();
    fd.set("content", trimmed);
    const result = await replyToStory(storyId, fd);
    if (result.error) {
      setStatus("error");
      setErrorMsg(replyErrorMessage(result.error));
      return;
    }
    setText("");
    setStatus("sent");
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          maxLength={1000}
          placeholder={`Reply to ${authorName}...`}
          className="flex-1 rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm text-white placeholder-white/60 outline-none focus:border-white"
        />
        <button
          type="button"
          disabled={!text.trim() || status === "sending"}
          onClick={send}
          aria-label="Send reply"
          className="shrink-0 rounded-full bg-accent p-2 text-accent-ink disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
      {status === "sent" && <p className="mt-1 text-xs text-white/80">Reply sent.</p>}
      {errorMsg && <p className="mt-1 text-xs text-danger">{errorMsg}</p>}
    </div>
  );
}
